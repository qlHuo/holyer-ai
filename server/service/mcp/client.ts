/**
 * MCP 协议客户端 — Streamable HTTP 单端点
 *
 * ## “连接”是什么
 * MCP 不是长连接：没有 socket、没有心跳、没有断线重连。
 * 所谓“连接” = 首次使用时完成一次协议协商，并在实例内记住协商结果。
 * 实例生命周期通常是一次请求 / 一次探测；请求结束即丢弃。
 *
 * ## 两种协议
 * - modern（2026-07-28）：无 initialize、无会话；每个请求自描述（headers + params._meta）
 * - legacy（2025-*）：initialize → notifications/initialized → 后续请求带 Mcp-Session-Id
 *
 * 协商顺序：server/discover → 现代 tools/list → legacy initialize。
 *
 * ## 实例状态
 * mode / protocolVersion / serverInfo / sessionId 都只存在于内存中：
 * - modern 请求自描述，实例状态几乎不影响通信；
 * - legacy 依赖 sessionId，实例销毁后下次会重新 initialize。
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

/** 现代协议版本：无握手、无会话 */
const MODERN_VERSION = '2026-07-28'
/** 现代协议的分界版本：>= 该日期的版本走无握手模式 */
const MODERN_BASELINE = '2026-01-01'
/** legacy 握手时声明的版本；服务端可返回自己的版本 */
const LEGACY_VERSION = '2025-06-18'
/** 单次 HTTP 请求超时（探测时由 probe 传入更短的值） */
const DEFAULT_TIMEOUT_MS = 30_000
/** 响应体上限，防止恶意/异常 Server 占满 Worker 内存 */
const MAX_RESPONSE_BYTES = 1_000_000
/** tools/list 翻页上限，防止无限游标 */
const MAX_TOOL_PAGES = 10
/** 工具数量上限，防止工具定义撑爆模型上下文 */
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

/**
 * 过滤危险头与非法的头名/值；被过滤的项静默丢弃。
 *
 * 用黑名单而非白名单：MCP Server 的认证头名称不统一（Authorization、X-Api-Key、
 * X-Goog-Api-Key…），白名单会误伤；这里只拦截会破坏请求或由协议托管的头。
 */
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

/**
 * 一次 MCP 客户端会话（内存态）。
 *
 * 使用方式：
 *   const client = new McpClient({ url, headers })
 *   await client.listTools()                 // 内部会先 connect()
 *   await client.callTool(name, args)        // 复用同一实例，不会重复协商
 *
 * 并发：connect() 通过 connectPromise 去重，多个并发调用只会协商一次。
 * 生命周期：不要跨请求复用带 session 的实例（legacy 会话可能已过期）；
 *          现代协议本身无状态，复用也不会出错。
 */
export class McpClient {
  private readonly url: string
  private readonly headers: Record<string, string>
  private readonly timeoutMs: number
  private readonly clientInfo: { name: string, version: string }

  /** JSON-RPC 自增 id；只在当前实例内唯一 */
  private nextId = 1
  /** 协商结果；unknown 表示尚未连接 */
  private mode: McpProtocolMode | 'unknown' = 'unknown'
  private protocolVersion?: string
  private serverInfo?: McpServerInfo
  /** DB 中上次探测到的版本；非空时跳过完整协商 */
  private readonly hintedVersion?: string
  /** legacy 会话 id；modern 协议不会产生 */
  private sessionId?: string
  /** 协商阶段若已经请求过 tools/list，缓存结果避免重复请求 */
  private prefetchedTools?: McpToolSnapshot[]
  /** 并发 connect() 去重 */
  private connectPromise?: Promise<void>

  constructor(options: McpClientOptions) {
    this.url = options.url
    this.headers = sanitizeRequestHeaders(options.headers)
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.clientInfo = options.clientInfo ?? { name: 'holyer-ai', version: '1.0.0' }
    this.hintedVersion = options.protocolVersion
  }

  /** 协商结果；未 connect 时 mode 为 unknown */
  get info(): McpClientInfo {
    return {
      mode: this.mode,
      protocolVersion: this.protocolVersion,
      serverInfo: this.serverInfo
    }
  }

  /**
   * 协商协议版本；幂等。
   *
   * 首次调用会发网络请求（server/discover / tools/list / initialize），
   * 成功后写入 mode 等状态；后续调用直接返回。
   * 并发调用共享同一个 Promise，避免重复握手。
   */
  async connect(signal?: AbortSignal): Promise<void> {
    if (this.mode !== 'unknown') return

    if (!this.connectPromise) {
      this.connectPromise = this.doConnect(signal).finally(() => {
        this.connectPromise = undefined
      })
    }
    return this.connectPromise
  }

  /**
   * 拉取工具清单（自动处理 nextCursor 分页）。
   *
   * 这是“发现”，通常在配置/刷新时调用；工具快照存在时，对话链路不会调用它。
   * 如果协商阶段已经请求过 tools/list，会直接复用 prefetchedTools。
   */
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

  /**
   * 执行工具。
   *
   * - name 必须是 Server 返回的原始工具名（不是 weather__get_weather 映射名）；
   * - isError 原样返回，由上层适配器决定如何处理——协议层不把它当异常；
   * - MRTR（resultType=input_required）当前不支持，显式报错而不是返回空结果。
   */
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

  /**
   * 协议协商：从新到旧依次尝试。
   *
   * 1. server/discover   — 2026-07-28 规范，服务端应实现
   * 2. 现代 tools/list   — 兼容未实现 discover 的现代 Server（结果顺带缓存）
   * 3. legacy initialize — 2025 及更早的服务端
   *
   * 网络错误 / 认证失败 / 404 等不会降级（换协议也救不了），
   * 只有协议层面的失败才继续尝试下一种。
   */
  private async doConnect(signal?: AbortSignal): Promise<void> {
    // 0) 已有持久化版本：直接按它通信，省掉探测与降级请求
    if (this.hintedVersion && await this.applyHintedVersion(this.hintedVersion, signal)) {
      return
    }

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

  /**
   * 按持久化版本直接进入对应模式。
   *
   * - modern：无握手，只需写入 mode / protocolVersion，零网络请求；
   * - legacy：直接 initialize + initialized，跳过 discover 与失败降级。
   *
   * 返回 false 表示提示已失效（Server 升级/降级、认证变更等），
   * 调用方继续走完整协商。提示失效本身不会把错误抛给用户。
   */
  private async applyHintedVersion(version: string, signal?: AbortSignal): Promise<boolean> {
    // modern 无握手，提示无法用一次轻量请求验证；一旦过期（Server 降级、地址切换）
    // 整场工具调用都会失败。因此提示只用于 legacy —— initialize 本身就是校验。
    if (version >= MODERN_BASELINE) return false

    try {
      const result = asRecord(await this.rpc('initialize', {
        protocolVersion: version,
        capabilities: {},
        clientInfo: this.clientInfo
      }, { headers: {}, signal }))

      this.mode = 'legacy'
      this.protocolVersion = isString(result.protocolVersion) ? result.protocolVersion : version
      this.serverInfo = readServerInfo(result)

      await this.notify('notifications/initialized', signal)
      return true
    } catch {
      // 清掉半初始化状态，交给完整协商重新判断
      this.mode = 'unknown'
      this.protocolVersion = undefined
      this.serverInfo = undefined
      this.sessionId = undefined
      return false
    }
  }

  // ─────────────────────────────────────────────
  // 传输
  // ─────────────────────────────────────────────

  /**
   * 发送一次 JSON-RPC 请求并等待匹配 id 的响应。
   *
   * 只负责信封、id、session、HTTP 状态码与 JSON-RPC error；
   * 工具业务失败（result.isError）不在这里处理。
   */
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

  /** 发送 JSON-RPC 通知（无 id、无响应体，预期 202） */
  private async notify(method: string, signal?: AbortSignal): Promise<void> {
    const body = { jsonrpc: '2.0', method, params: {} }
    const res = await this.post(body, this.legacyHeaders(), signal)

    // 通知的预期响应是 202（无 body）
    if (res.status === 202) return
    if (!res.ok) {
      throw new McpError('http', `MCP 通知失败：HTTP ${res.status}`, { status: res.status })
    }
  }

  /**
   * 底层 HTTP POST。
   *
   * - 超时与外部取消合并：任一触发都会中止 fetch；
   * - redirect: 'manual'：防止被重定向到内网（SSRF）；
   * - Accept 同时声明 JSON 与 SSE，由服务端决定响应形态。
   */
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

  /** legacy 服务端在 initialize 响应头里下发会话 id；modern 不会有 */
  private captureSession(res: Response): void {
    const sessionId = res.headers.get('mcp-session-id')
    if (sessionId) this.sessionId = sessionId
  }

  /**
   * 2026-07-28 要求每个 POST 带版本与方法头；
   * Mcp-Name 只在有子目标的请求（tools/call、resources/read…）中携带。
   */
  private modernHeaders(method: string, name?: string): Record<string, string> {
    return {
      'MCP-Protocol-Version': this.protocolVersion ?? MODERN_VERSION,
      'Mcp-Method': method,
      ...(name ? { 'Mcp-Name': name } : {})
    }
  }

  /** 没有 initialize 后，请求通过 _meta 自描述版本、客户端信息与能力 */
  private modernMeta(version = this.protocolVersion ?? MODERN_VERSION): Record<string, unknown> {
    return {
      'io.modelcontextprotocol/protocolVersion': version,
      'io.modelcontextprotocol/clientInfo': this.clientInfo,
      'io.modelcontextprotocol/clientCapabilities': {}
    }
  }

  /** legacy 请求头：会话 id + 协议版本（2025-03-26 起进入规范） */
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

/**
 * 读取非 SSE 响应体，边读边按字节计数。
 *
 * 不能先 res.text() 再检查长度：超大响应在读取阶段就已经占满 Worker 内存。
 * Content-Length 只用于提前拒绝；实际上限以读到的字节数为准。
 */
async function readTextLimited(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new McpError('protocol', 'MCP 响应超过大小限制')
  }

  const reader = res.body?.getReader()
  if (!reader) return ''

  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      bytes += value?.byteLength ?? 0
      if (bytes > MAX_RESPONSE_BYTES) {
        throw new McpError('protocol', 'MCP 响应超过大小限制')
      }
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => {})
  }

  return text + decoder.decode()
}

/**
 * 解析一次响应：JSON 或 SSE。
 *
 * Streamable HTTP 允许服务端二选一：
 * - application/json        → 单条 JSON-RPC 消息
 * - text/event-stream       → 逐事件读取，取 id 匹配的那一条
 */
async function readMessage(res: Response, id: number): Promise<JsonRpcMessage> {
  const contentType = res.headers.get('content-type') ?? ''

  if (contentType.includes('text/event-stream')) {
    return readSseMessage(res, id)
  }

  const text = await readTextLimited(res)

  let message: JsonRpcMessage
  try {
    message = JSON.parse(text) as JsonRpcMessage
  } catch {
    throw new McpError('protocol', '响应不是合法 JSON，可能不是 MCP Server')
  }

  validateEnvelope(message, id)
  return message
}

/**
 * 读取 SSE 流，直到收到与请求 id 匹配的 JSON-RPC 响应。
 *
 * 事件以空行分隔；一个事件可能有多行 data，需要拼接。
 * 找到目标响应后立即取消 reader，避免服务端保持长连接时挂住。
 * 心跳、通知、非 JSON 事件都会被忽略。
 */
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

/** 校验最小 JSON-RPC 信封：版本必须是 2.0，id 必须与请求一致 */
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

/**
 * 把 tools/list 结果归一化为快照。
 *
 * 结构不合法的单个工具会被跳过，而不是让整个 Server 不可用；
 * 真正的清洗（$ref、anyOf 等）发生在 tool-adapter。
 */
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

/** 分页或服务端重复时按 name 去重，保留首次出现 */
function dedupeTools(tools: McpToolSnapshot[]): McpToolSnapshot[] {
  const seen = new Set<string>()
  return tools.filter((tool) => {
    if (seen.has(tool.name)) return false
    seen.add(tool.name)
    return true
  })
}

/** modern 在 result._meta；legacy 在 result.serverInfo */
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
