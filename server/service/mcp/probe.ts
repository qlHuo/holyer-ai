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

const PROBE_TIMEOUT_MS = 10_000

export interface ProbeInput {
  url: string
  headers?: Record<string, string>
  /** 仅开发环境：允许 localhost（本地测试 MCP Server） */
  allowLoopback?: boolean
  timeoutMs?: number
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

  try {
    await client.connect()
    const tools = await client.listTools()

    return {
      ok: true,
      protocolVersion: client.info.protocolVersion,
      serverInfo: client.info.serverInfo,
      tools
    }
  } catch (error) {
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
