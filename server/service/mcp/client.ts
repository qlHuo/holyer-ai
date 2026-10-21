/**
 * MCP 协议客户端 — Streamable HTTP 单端点
 *
 * 支持两种握手：
 * - modern（2026-07-28）：server/discover，无 initialize / 无会话
 * - legacy（2025-*）：initialize → notifications/initialized → Mcp-Session-Id
 *
 * 只实现 tools 原语。不支持双端点 HTTP+SSE 传输、OAuth 与 MRTR。
 */

import { mergeAbortSignals } from '../../utils/abort'
import { McpError } from './errors'
import type {
  McpCallResult,
  McpClientInfo,
  McpClientOptions,
  McpContent,
  McpProtocolMode,
  McpServerInfo,
  McpToolSnapshot
} from './types'

const MODERN_VERSION = '2026-07-28'
const LEGACY_VERSION = '2025-06-18'
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_RESPONSE_BYTES = 1_000_000
const MAX_TOOL_PAGES = 10
const MAX_TOOLS = 1_000

/** 协议托管或可能破坏请求的头，用户不能覆盖 */
const BLOCKED_HEADERS = new Set([
  'host',
  'content-length',
  'content-type',
  'accept',
  'accept-encoding',
  'connection',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'proxy-authorization',
  'proxy-connection',
  'cookie',
  'mcp-session-id',
  'mcp-protocol-version',
  'mcp-method',
  'mcp-name'
])

const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

/** 过滤危险头与非法的头名/值；被过滤的项静默丢弃 */
export function sanitizeRequestHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  if (!headers) return {}

  const result: Record<string, string> = {}
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.trim()
    if (!name || BLOCKED_HEADERS.has(name.toLowerCase())) continue
    if (!HEADER_NAME_RE.test(name)) continue

    const value = String(rawValue).trim()
    if (/[\r\n]/.test(value)) continue

    result[name] = value
  }
  return result
}

interface JsonRpcMessage {
  jsonrpc?: string
  id?: string | number | null
  result?: unknown
  error?: { code?: number, message?: string, data?: unknown }
}

interface RpcOptions {
  headers?: Record<string, string>
  meta?: Record<string, unknown>
  signal?: AbortSignal
}

export class McpClient {
  private readonly url: string
  private readonly headers: Record<string, string>
  private readonly timeoutMs: number
  private readonly clientInfo: { name: string, version: string }

  private nextId = 1
  private mode: McpProtocolMode | 'unknown' = 'unknown'
  private protocolVersion?: string
  private serverInfo?: McpServerInfo
  private sessionId?: string
  private prefetchedTools?: McpToolSnapshot[]
  private connectPromise?: Promise<void>

  constructor(options: McpClientOptions) {
    this.url = options.url
    this.headers = sanitizeRequestHeaders(options.headers)
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.clientInfo = options.clientInfo ?? { name: 'holyer-ai', version: '1.0.0' }
  }

  get info(): McpClientInfo {
    return {
      mode: this.mode,
      protocolVersion: this.protocolVersion,
      serverInfo: this.serverInfo
    }
  }

  /** 协商协议版本；幂等 */
  async connect(signal?: AbortSignal): Promise<void> {
    if (this.mode !== 'unknown') return

    if (!this.connectPromise) {
      this.connectPromise = this.doConnect(signal).finally(() => {
        this.connectPromise = undefined
      })
    }
    return this.connectPromise
  }

  async listTools(signal?: AbortSignal): Promise<McpToolSnapshot[]> {
    await this.connect(signal)

    if (this.prefetchedTools) {
      const tools = this.prefetchedTools
      this.prefetchedTools = undefined
      return tools
    }

    const collected: McpToolSnapshot[] = []
    let cursor: string | undefined

    for (let page = 0; page < MAX_TOOL_PAGES; page++) {
      const params = cursor ? { cursor } : {}
      const result = this.mode === 'modern'
        ? asRecord(await this.rpc('tools/list', params, {
            headers: this.modernHeaders('tools/list'),
            meta: this.modernMeta(),
            signal
          }))
        : asRecord(await this.rpc('tools/list', params, {
            headers: this.legacyHeaders(),
            signal
          }))

      collected.push(...normalizeTools(result))
      cursor = isString(result.nextCursor) ? result.nextCursor : undefined

      if (!cursor) break
      if (page === MAX_TOOL_PAGES - 1) {
        throw new McpError('protocol', 'tools/list 分页超过上限')
      }
    }

    if (collected.length > MAX_TOOLS) {
      throw new McpError('protocol', `工具数量超过上限（${MAX_TOOLS}）`)
    }
    return dedupeTools(collected)
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<McpCallResult> {
    await this.connect(signal)

    const params = { name, arguments: args }
    const result = this.mode === 'modern'
      ? asRecord(await this.rpc('tools/call', params, {
          headers: this.modernHeaders('tools/call', name),
          meta: this.modernMeta(),
          signal
        }))
      : asRecord(await this.rpc('tools/call', params, {
          headers: this.legacyHeaders(),
          signal
        }))

    if (result.resultType === 'input_required') {
      throw new McpError('unsupported', '该工具需要多轮交互（MRTR），当前版本不支持')
    }

    return {
      content: Array.isArray(result.content) ? result.content as McpContent[] : [],
      structuredContent: result.structuredContent,
      isError: result.isError === true
    }
  }

  // ─────────────────────────────────────────────
  // 协商
  // ─────────────────────────────────────────────

  private async doConnect(signal?: AbortSignal): Promise<void> {
    // 1) 2026-07-28：server/discover
    try {
      const result = asRecord(await this.rpc('server/discover', {}, {
        headers: this.modernHeaders('server/discover'),
        meta: this.modernMeta(MODERN_VERSION),
        signal
      }))
      const versions = Array.isArray(result.supportedVersions)
        ? result.supportedVersions.filter(isString)
        : []

      if (versions.length > 0 && !versions.includes(MODERN_VERSION)) {
        throw new McpError('unsupported', `服务端不支持 ${MODERN_VERSION}`)
      }

      this.mode = 'modern'
      this.protocolVersion = MODERN_VERSION
      this.serverInfo = readServerInfo(result)
      return
    } catch (error) {
      rethrowIfNotFallbackable(error)
    }

    // 2) 现代格式 tools/list
    try {
      const result = asRecord(await this.rpc('tools/list', {}, {
        headers: this.modernHeaders('tools/list'),
        meta: this.modernMeta(MODERN_VERSION),
        signal
      }))
      this.mode = 'modern'
      this.protocolVersion = MODERN_VERSION
      this.prefetchedTools = normalizeTools(result)
      return
    } catch (error) {
      rethrowIfNotFallbackable(error)
    }

    // 3) legacy：initialize + initialized
    const result = asRecord(await this.rpc('initialize', {
      protocolVersion: LEGACY_VERSION,
      capabilities: {},
      clientInfo: this.clientInfo
    }, { headers: {}, signal }))

    this.mode = 'legacy'
    this.protocolVersion = isString(result.protocolVersion) ? result.protocolVersion : LEGACY_VERSION
    this.serverInfo = readServerInfo(result)

    await this.notify('notifications/initialized', signal)
  }

  // ─────────────────────────────────────────────
  // 传输
  // ─────────────────────────────────────────────

  private async rpc(method: string, params: Record<string, unknown>, options: RpcOptions): Promise<unknown> {
    const id = this.nextId++
    const body = {
      jsonrpc: '2.0',
      id,
      method,
      params: options.meta ? { ...params, _meta: options.meta } : params
    }

    const res = await this.post(body, options.headers ?? {}, options.signal)
    this.captureSession(res)

    if (res.status >= 300 && res.status < 400) {
      throw new McpError('http', 'MCP Server 返回重定向，已拒绝跟随', { status: res.status })
    }
    if (res.status === 401 || res.status === 403) {
      throw new McpError('auth', `MCP Server 要求认证（HTTP ${res.status}）`, { status: res.status })
    }
    if (!res.ok) {
      throw new McpError('http', `MCP Server 返回 HTTP ${res.status}`, { status: res.status })
    }

    const message = await readMessage(res, id)
    if (message.error) {
      throw new McpError(
        'rpc',
        isString(message.error.message) ? message.error.message : 'MCP 返回错误',
        { code: typeof message.error.code === 'number' ? message.error.code : undefined }
      )
    }
    return message.result
  }

  private async notify(method: string, signal?: AbortSignal): Promise<void> {
    const body = { jsonrpc: '2.0', method, params: {} }
    const res = await this.post(body, this.legacyHeaders(), signal)

    // 通知的预期响应是 202（无 body）
    if (res.status === 202) return
    if (!res.ok) {
      throw new McpError('http', `MCP 通知失败：HTTP ${res.status}`, { status: res.status })
    }
  }

  private async post(
    body: Record<string, unknown>,
    headers: Record<string, string>,
    signal?: AbortSignal
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const merged = mergeAbortSignals(signal, timeout)

    try {
      return await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          ...this.headers,
          ...headers
        },
        body: JSON.stringify(body),
        signal: merged,
        redirect: 'manual'
      })
    } catch (error) {
      if (signal?.aborted) throw error
      if (timeout.aborted) {
        throw new McpError('timeout', `MCP 请求超时（${this.timeoutMs}ms）`)
      }
      throw new McpError('unreachable', `无法连接 MCP Server：${errorMessage(error)}`)
    }
  }

  private captureSession(res: Response): void {
    const sessionId = res.headers.get('mcp-session-id')
    if (sessionId) this.sessionId = sessionId
  }

  private modernHeaders(method: string, name?: string): Record<string, string> {
    return {
      'MCP-Protocol-Version': this.protocolVersion ?? MODERN_VERSION,
      'Mcp-Method': method,
      ...(name ? { 'Mcp-Name': name } : {})
    }
  }

  private modernMeta(version = this.protocolVersion ?? MODERN_VERSION): Record<string, unknown> {
    return {
      'io.modelcontextprotocol/protocolVersion': version,
      'io.modelcontextprotocol/clientInfo': this.clientInfo,
      'io.modelcontextprotocol/clientCapabilities': {}
    }
  }

  private legacyHeaders(): Record<string, string> {
    const headers: Record<string, string> = { ...this.headers }

    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId
    }
    // MCP-Protocol-Version 从 2025-03-26 起进入规范
    if (this.protocolVersion && this.protocolVersion >= '2025-03-26') {
      headers['MCP-Protocol-Version'] = this.protocolVersion
    }
    return headers
  }
}

// ─────────────────────────────────────────────
// 响应解析
// ─────────────────────────────────────────────

async function readMessage(res: Response, id: number): Promise<JsonRpcMessage> {
  const contentType = res.headers.get('content-type') ?? ''

  if (contentType.includes('text/event-stream')) {
    return readSseMessage(res, id)
  }

  const text = await res.text()
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new McpError('protocol', 'MCP 响应超过大小限制')
  }

  let message: JsonRpcMessage
  try {
    message = JSON.parse(text) as JsonRpcMessage
  } catch {
    throw new McpError('protocol', '响应不是合法 JSON，可能不是 MCP Server')
  }

  validateEnvelope(message, id)
  return message
}

/** 读取 SSE 流，直到收到与请求 id 匹配的 JSON-RPC 响应 */
async function readSseMessage(res: Response, id: number): Promise<JsonRpcMessage> {
  const reader = res.body?.getReader()
  if (!reader) {
    throw new McpError('protocol', 'MCP 响应没有 body')
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let bytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      bytes += value?.byteLength ?? 0
      if (bytes > MAX_RESPONSE_BYTES) {
        throw new McpError('protocol', 'MCP 响应超过大小限制')
      }

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')

      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)

        const data = block
          .split('\n')
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trimStart())
          .join('\n')

        if (data) {
          let message: JsonRpcMessage | undefined
          try {
            message = JSON.parse(data) as JsonRpcMessage
          } catch {
            // 忽略心跳/非 JSON 事件
          }
          if (message && message.id === id) {
            validateEnvelope(message, id)
            return message
          }
        }

        boundary = buffer.indexOf('\n\n')
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }

  throw new McpError('protocol', 'MCP SSE 流结束但未收到匹配的响应')
}

function validateEnvelope(message: JsonRpcMessage, id: number): void {
  if (message?.jsonrpc !== '2.0') {
    throw new McpError('protocol', '响应不是 JSON-RPC 2.0')
  }
  if (message.id !== id) {
    throw new McpError('protocol', '响应 id 与请求不匹配')
  }
}

// ─────────────────────────────────────────────
// 工具与结果归一化
// ─────────────────────────────────────────────

function normalizeTools(result: Record<string, unknown>): McpToolSnapshot[] {
  const tools = result.tools
  if (!Array.isArray(tools)) {
    throw new McpError('protocol', 'tools/list 响应缺少 tools 数组')
  }

  const normalized: McpToolSnapshot[] = []
  for (const item of tools) {
    if (!isRecord(item)) continue
    if (!isString(item.name) || !item.name) continue
    if (!isRecord(item.inputSchema)) continue

    normalized.push({
      name: item.name,
      description: isString(item.description) ? item.description : undefined,
      inputSchema: item.inputSchema,
      annotations: isRecord(item.annotations) ? item.annotations : undefined
    })
  }
  return normalized
}

function dedupeTools(tools: McpToolSnapshot[]): McpToolSnapshot[] {
  const seen = new Set<string>()
  return tools.filter((tool) => {
    if (seen.has(tool.name)) return false
    seen.add(tool.name)
    return true
  })
}

function readServerInfo(result: Record<string, unknown>): McpServerInfo | undefined {
  const meta = isRecord(result._meta) ? result._meta : undefined
  const info = meta?.['io.modelcontextprotocol/serverInfo'] ?? result.serverInfo
  if (!isRecord(info)) return undefined

  return {
    name: isString(info.name) ? info.name : undefined,
    version: isString(info.version) ? info.version : undefined
  }
}

/**
 * 只有协议层面的失败才值得尝试另一种握手。
 * 部分 legacy Server 对现代请求返回 400/406/415，而不是 JSON-RPC 错误，也应降级。
 */
function rethrowIfNotFallbackable(error: unknown): void {
  if (!(error instanceof McpError)) throw error
  if (['protocol', 'rpc', 'unsupported'].includes(error.kind)) return
  if (error.kind === 'http' && [400, 406, 415].includes(error.meta.status ?? 0)) return
  throw error
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return '未知错误'

  // undici 的 "fetch failed" 把真实原因藏在 cause 里（ECONNREFUSED / 证书错误等）
  const cause = (error as { cause?: unknown }).cause
  if (cause instanceof Error) {
    const code = (cause as { code?: string }).code
    return `${error.message}（${code ? `${code} ` : ''}${cause.message}）`
  }
  return error.message
}
