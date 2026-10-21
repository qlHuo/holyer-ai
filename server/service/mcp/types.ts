/** MCP 工具快照 — 由 tools/list 得到，存 DB 供对话侧使用 */
export interface McpToolSnapshot {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  annotations?: Record<string, unknown>
}

/** 对话侧使用的 Server 配置（M3 起来自 DB，当前开发阶段来自运行时配置） */
export interface McpServerConfig {
  id: string
  name: string
  slug: string
  url: string
  headers: Record<string, string>
  enabled: boolean
  tools: McpToolSnapshot[]
  disabledTools: string[]
}

export interface McpServerInfo {
  name?: string
  version?: string
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

export type ProbeErrorKind
  = | 'invalid-url'
    | 'unreachable'
    | 'timeout'
    | 'auth'
    | 'not-found'
    | 'not-mcp'
    | 'unsupported'

export interface ProbeResult {
  ok: boolean
  protocolVersion?: string
  serverInfo?: McpServerInfo
  tools?: McpToolSnapshot[]
  error?: { kind: ProbeErrorKind, message: string }
}
