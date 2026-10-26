/**
 * MCP — 前后端共享类型（API 契约）
 *
 * 管理侧与对话侧共用：工具快照、Server 视图、探测结果。
 * headers 在 API 响应中一律脱敏，前端看到的是 MCP_HEADER_MASK。
 */

/** headers 脱敏后的占位值；提交时原样回传表示「保持原值」 */
export const MCP_HEADER_MASK = '••••••••'

/** 工具快照 — tools/list 的结果，存 DB 供对话侧使用 */
export interface McpToolSnapshot {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  annotations?: Record<string, unknown>
}

export interface McpServerInfo {
  name?: string
  version?: string
}

/** 探测时返回的、可保存为快照的最小数据 */
export interface McpServerSnapshot {
  protocolVersion?: string
  serverInfo?: McpServerInfo
  tools: McpToolSnapshot[]
}

/** 管理页使用的 Server 视图（headers 已脱敏） */
export interface McpServerSummary {
  id: string
  name: string
  slug: string
  url: string
  /** 值全部替换为 MCP_HEADER_MASK；键保留，便于前端展示与回传 */
  headers: Record<string, string>
  enabled: boolean
  protocolVersion: string | null
  serverInfo: McpServerInfo | null
  tools: McpToolSnapshot[]
  disabledTools: string[]
  toolsFetchedAt: string | null
  lastCheckedAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

/** 新建 Server — POST /api/mcp/servers */
export interface CreateMcpServerInput {
  name: string
  /** 创建后不可修改：参与工具命名 */
  slug: string
  url: string
  headers: Record<string, string>
  enabled?: boolean
  /** 「测试连接」成功后可一并保存，避免再刷新一次 */
  snapshot?: McpServerSnapshot
}

/** 全量修改 — PUT /api/mcp/servers/:id */
export interface UpdateMcpServerInput {
  name: string
  url: string
  headers: Record<string, string>
  enabled: boolean
  disabledTools?: string[]
  snapshot?: McpServerSnapshot
}

/** 局部修改 — PATCH /api/mcp/servers/:id（列表页快速启停） */
export interface PatchMcpServerInput {
  enabled?: boolean
  disabledTools?: string[]
}

/** 探测 — POST /api/mcp/servers/probe */
export interface McpProbeInput {
  url: string
  headers?: Record<string, string>
  /** 编辑已有 Server 时传入：服务端用已存 headers 补齐脱敏值 */
  serverId?: string
}

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

/** 刷新结果 — POST /api/mcp/servers/:id/refresh */
export interface McpRefreshResult {
  server: McpServerSummary
  probe: ProbeResult
}
