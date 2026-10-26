/**
 * MCP Server 连通性探测
 *
 * 管理页「测试连接」调用：校验 URL → 协商协议 → 拉取工具清单。
 * 不写库；成功结果由调用方决定是否保存为快照。
 */

import { assertSafeHttpUrl, UnsafeUrlError } from '../../utils/url-safety'
import { McpClient, sanitizeRequestHeaders } from './client'
import { McpError } from './errors'
import type { ProbeErrorKind, ProbeResult } from './types'

/** 单次 HTTP 请求超时 */
const PROBE_TIMEOUT_MS = 10_000
/** 整个探测（含 tools/list 分页）的总时限；必须小于前端 30s 请求超时 */
const PROBE_DEADLINE_MS = 20_000

export interface ProbeInput {
  url: string
  headers?: Record<string, string>
  /** 仅开发环境：允许 localhost（本地测试 MCP Server） */
  allowLoopback?: boolean
  /** 单次请求超时 */
  timeoutMs?: number
  /** 整个探测的总时限（connect + 全部分页） */
  deadlineMs?: number
}

export async function probeMcpServer(input: ProbeInput): Promise<ProbeResult> {
  let url: URL
  try {
    url = assertSafeHttpUrl(input.url, { allowLoopback: input.allowLoopback })
  } catch (error) {
    if (error instanceof UnsafeUrlError) {
      return { ok: false, error: { kind: 'invalid-url', message: error.message } }
    }
    return { ok: false, error: { kind: 'invalid-url', message: 'URL 校验失败' } }
  }

  const client = new McpClient({
    url: url.toString(),
    headers: sanitizeRequestHeaders(input.headers),
    timeoutMs: input.timeoutMs ?? PROBE_TIMEOUT_MS
  })

  // 单次请求各自有 10s 超时，但 tools/list 最多 10 页顺序请求；
  // 没有总时限时最坏可拖到 100s，超过前端 30s 超时并造成「前端报失败、后端已写库」。
  const deadlineMs = input.deadlineMs ?? PROBE_DEADLINE_MS
  const deadline = AbortSignal.timeout(deadlineMs)

  try {
    await client.connect(deadline)
    const tools = await client.listTools(deadline)

    return {
      ok: true,
      protocolVersion: client.info.protocolVersion,
      serverInfo: client.info.serverInfo,
      tools
    }
  } catch (error) {
    if (deadline.aborted) {
      return {
        ok: false,
        error: { kind: 'timeout', message: `探测超时（${deadlineMs}ms），请稍后重试` }
      }
    }
    return { ok: false, error: toProbeError(error) }
  }
}

function toProbeError(error: unknown): { kind: ProbeErrorKind, message: string } {
  if (!(error instanceof McpError)) {
    return {
      kind: 'not-mcp',
      message: error instanceof Error ? error.message : '探测失败'
    }
  }

  switch (error.kind) {
    case 'unreachable':
      return { kind: 'unreachable', message: '无法连接到该地址，请检查网络或地址' }
    case 'timeout':
      return { kind: 'timeout', message: '连接超时，请检查地址或稍后重试' }
    case 'auth':
      return { kind: 'auth', message: '需要认证，请填写正确的请求头' }
    case 'http':
      if (error.meta.status === 404) {
        return { kind: 'not-found', message: '该地址不存在，MCP 端点通常以 /mcp 结尾' }
      }
      if (error.meta.status === 405) {
        return { kind: 'not-mcp', message: '该地址不接受 POST 请求，可能不是 MCP 端点' }
      }
      return { kind: 'not-mcp', message: error.message }
    case 'rpc':
      if (error.meta.code === -32601) {
        return { kind: 'not-mcp', message: '该服务不支持 tools/list，可能不是 MCP 服务或版本不兼容' }
      }
      return { kind: 'not-mcp', message: error.message }
    case 'protocol':
      return { kind: 'not-mcp', message: error.message }
    case 'unsupported':
      return { kind: 'unsupported', message: error.message }
    default:
      return { kind: 'not-mcp', message: error.message }
  }
}
