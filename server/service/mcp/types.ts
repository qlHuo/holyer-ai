/**
 * MCP 服务端内部类型
 *
 * API 契约类型（快照 / Server 视图 / 探测结果）在 shared/types/mcp.ts，
 * 这里只保留协议客户端与运行时装配用的类型，并转出共享类型供既有 import 使用。
 */

import type { McpServerInfo, McpToolSnapshot } from '~~/shared/types/mcp'

export type { McpServerInfo, McpToolSnapshot, ProbeErrorKind, ProbeResult } from '~~/shared/types/mcp'

/** 对话侧使用的 Server 配置（来自 DB 行，headers 为明文） */
export interface McpServerConfig {
  id: string
  name: string
  slug: string
  url: string
  headers: Record<string, string>
  enabled: boolean
  /** 上次探测到的协议版本；用于跳过重复协商 */
  protocolVersion?: string
  tools: McpToolSnapshot[]
  disabledTools: string[]
}

export type McpContent
  = | { type: 'text', text: string }
    | { type: 'image', data: string, mimeType: string }
    | { type: 'audio', data: string, mimeType: string }
    | { type: 'resource', resource: Record<string, unknown> }
    | { type: string, [key: string]: unknown }

export interface McpCallResult {
  content: McpContent[]
  structuredContent?: unknown
  isError?: boolean
}

export interface McpClientOptions {
  url: string
  headers?: Record<string, string>
  timeoutMs?: number
  clientInfo?: { name: string, version: string }
  /**
   * 上次持久化的协议版本。
   * 仅 legacy 生效：直接 initialize + initialized，跳过 discover 与失败降级。
   * modern 提示不生效（无握手，无法低成本校验，仍走 discover 确认）。
   */
  protocolVersion?: string
}

export type McpProtocolMode = 'modern' | 'legacy'

export interface McpClientInfo {
  mode: McpProtocolMode | 'unknown'
  protocolVersion?: string
  serverInfo?: McpServerInfo
}

export type McpErrorKind
  = | 'unreachable'
    | 'timeout'
    | 'auth'
    | 'http'
    | 'protocol'
    | 'rpc'
    | 'unsupported'
