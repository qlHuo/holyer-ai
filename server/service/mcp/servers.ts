/**
 * MCP Server 配置与运行时装配
 *
 * 两个方向：
 * - 管理侧：CRUD、探测快照的保存、刷新、配额校验
 * - 对话侧：读取启用 Server 的快照 → ExecutableTool（不在聊天路径上做远程发现）
 *
 * 快照是对话侧唯一的数据来源；刷新失败保留旧快照，只更新 lastError。
 */

import { asc, eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { mcpServers } from '~~/server/db/schema'
import { MCP_HEADER_MASK } from '~~/shared/types/mcp'
import type {
  CreateMcpServerInput,
  McpRefreshResult,
  McpServerSummary,
  PatchMcpServerInput,
  UpdateMcpServerInput
} from '~~/shared/types/mcp'
import type { ExecutableTool } from '../agent/tools/types'
import { McpClient } from './client'
import { McpConfigError } from './errors'
import { probeMcpServer } from './probe'
import { createMcpTools } from './tool-adapter'
import type { McpServerConfig, McpToolSnapshot } from './types'

/** 全局上限：Server 数量与启用工具总数（防工具定义撑爆模型上下文） */
const MAX_SERVERS = 10
const MAX_ENABLED_TOOLS = 50

type McpServerRow = typeof mcpServers.$inferSelect

// ─────────────────────────────────────────────
// 对话侧：读取快照并装配工具
// ─────────────────────────────────────────────

/** 对话运行时使用的启用 Server（headers 明文，只用于发请求） */
export async function getEnabledMcpServers(): Promise<McpServerConfig[]> {
  const rows = await db.select()
    .from(mcpServers)
    .where(eq(mcpServers.enabled, true))
    .orderBy(asc(mcpServers.createdAt))

  return rows.map(toConfig)
}

/**
 * 加载本次对话可用的 MCP 工具。
 *
 * - 只读快照，不发起 tools/list；
 * - 单个 Server 数据异常只跳过该 Server；
 * - DB 读取失败退回「仅内置工具」，不影响对话。
 */
export async function loadMcpTools(_signal?: AbortSignal): Promise<ExecutableTool[]> {
  let servers: McpServerConfig[]
  try {
    servers = await getEnabledMcpServers()
  } catch (error) {
    console.error('[mcp] 读取 Server 配置失败，本次对话仅使用内置工具：', error)
    return []
  }

  const tools: ExecutableTool[] = []
  // 跨 Server 共享已用名集合：两个 Server 的 slug__tool 撞名时由 adapter 追加哈希后缀，
  // 否则 ToolRegistry.register 会因重名直接抛错，整个回合装配失败。
  const usedNames = new Set<string>()

  for (const server of servers) {
    const snapshots = server.tools.filter(tool => !server.disabledTools.includes(tool.name))
    if (snapshots.length === 0) continue

    const client = new McpClient({
      url: server.url,
      headers: server.headers,
      protocolVersion: server.protocolVersion
    })
    tools.push(...createMcpTools(server, snapshots, client, usedNames))
  }

  if (import.meta.dev) {
    console.info(
      `[mcp] Servers=${servers.length}, tools=${tools.map(tool => tool.name).join(', ') || 'none'}`
    )
  }

  return tools
}

// ─────────────────────────────────────────────
// 管理侧：查询
// ─────────────────────────────────────────────

export async function getMcpServerList(): Promise<McpServerSummary[]> {
  const rows = await db.select().from(mcpServers).orderBy(asc(mcpServers.createdAt))
  return rows.map(toSummary)
}

/** 供探测接口用已存 headers 补齐脱敏值 */
export async function getMcpServerConfigById(id: string): Promise<McpServerConfig | null> {
  const row = await getRow(id)
  return row ? toConfig(row) : null
}

// ─────────────────────────────────────────────
// 管理侧：写入
// ─────────────────────────────────────────────

export async function createMcpServer(input: CreateMcpServerInput): Promise<McpServerSummary> {
  const duplicate = await db.select({ id: mcpServers.id })
    .from(mcpServers)
    .where(eq(mcpServers.slug, input.slug))
    .limit(1)

  if (duplicate.length > 0) {
    throw new McpConfigError('duplicate', `slug "${input.slug}" 已被使用`)
  }

  const existing = await db.select({ id: mcpServers.id }).from(mcpServers)
  if (existing.length >= MAX_SERVERS) {
    throw new McpConfigError('limit', `MCP Server 数量已达上限（${MAX_SERVERS} 个）`)
  }

  const snapshot = input.snapshot
  const tools = snapshot?.tools ?? []
  const enabled = input.enabled ?? false

  if (enabled) await assertToolQuota(tools.length, null)

  const now = new Date()
  const [row] = await db.insert(mcpServers).values({
    name: input.name.trim(),
    slug: input.slug,
    url: input.url,
    headers: cleanCreateHeaders(input.headers),
    enabled,
    protocolVersion: snapshot?.protocolVersion ?? null,
    serverInfo: snapshot?.serverInfo ?? null,
    tools,
    disabledTools: [],
    toolsFetchedAt: snapshot ? now : null,
    lastCheckedAt: snapshot ? now : null,
    lastError: null
  }).returning()

  return toSummary(row!)
}

export async function updateMcpServer(
  id: string,
  input: UpdateMcpServerInput
): Promise<McpServerSummary | null> {
  const current = await getRow(id)
  if (!current) return null

  const snapshot = input.snapshot
  const urlChanged = current.url !== input.url

  // 地址变更后旧快照整体失效：工具名、协议版本、Server 信息都只对旧端点成立。
  // 同一次保存带了新探测快照则用新快照；否则清空，等用户点刷新。
  const tools = snapshot ? snapshot.tools : urlChanged ? [] : current.tools
  const disabledSource = snapshot || !urlChanged
    ? (input.disabledTools ?? current.disabledTools)
    : []
  const disabledTools = filterDisabledTools(disabledSource, tools)
  const enabled = input.enabled

  if (enabled) await assertToolQuota(countEnabledTools(tools, disabledTools), id)

  // 地址变更时不复用已存密钥：避免把旧凭证发往新主机
  const headers = urlChanged
    ? mergeHeaders({}, input.headers)
    : mergeHeaders(current.headers, input.headers)

  const now = new Date()
  const [row] = await db.update(mcpServers).set({
    name: input.name.trim(),
    url: input.url,
    headers,
    enabled,
    protocolVersion: snapshot ? (snapshot.protocolVersion ?? null) : urlChanged ? null : current.protocolVersion,
    serverInfo: snapshot ? (snapshot.serverInfo ?? null) : urlChanged ? null : current.serverInfo,
    tools,
    disabledTools,
    toolsFetchedAt: snapshot ? now : urlChanged ? null : current.toolsFetchedAt,
    lastCheckedAt: snapshot ? now : urlChanged ? null : current.lastCheckedAt,
    lastError: snapshot || urlChanged ? null : current.lastError,
    updatedAt: now
  }).where(eq(mcpServers.id, id)).returning()

  return toSummary(row!)
}

/** 局部修改：列表页的启停开关与工具级开关 */
export async function patchMcpServer(
  id: string,
  patch: PatchMcpServerInput
): Promise<McpServerSummary | null> {
  const current = await getRow(id)
  if (!current) return null

  const disabledTools = patch.disabledTools
    ? filterDisabledTools(patch.disabledTools, current.tools)
    : current.disabledTools
  const enabled = patch.enabled ?? current.enabled

  if (enabled) await assertToolQuota(countEnabledTools(current.tools, disabledTools), id)

  const [row] = await db.update(mcpServers).set({
    enabled,
    disabledTools,
    updatedAt: new Date()
  }).where(eq(mcpServers.id, id)).returning()

  return toSummary(row!)
}

export async function deleteMcpServer(id: string): Promise<boolean> {
  const deleted = await db.delete(mcpServers).where(eq(mcpServers.id, id)).returning()
  return deleted.length > 0
}

/**
 * 刷新工具快照。
 *
 * 成功：写入工具、协议版本与抓取时间，清空 lastError；
 * 失败：保留旧快照，只更新 lastCheckedAt / lastError。
 */
export async function refreshMcpServer(id: string): Promise<McpRefreshResult | null> {
  const current = await getRow(id)
  if (!current) return null

  const probe = await probeMcpServer({
    url: current.url,
    headers: current.headers,
    allowLoopback: import.meta.dev
  })
  const now = new Date()

  if (!probe.ok) {
    const [row] = await db.update(mcpServers).set({
      lastCheckedAt: now,
      lastError: probe.error?.message ?? '刷新失败',
      updatedAt: now
    }).where(eq(mcpServers.id, id)).returning()

    return { server: toSummary(row!), probe }
  }

  const tools = probe.tools ?? []
  const disabledTools = filterDisabledTools(current.disabledTools, tools)

  if (current.enabled) {
    await assertToolQuota(countEnabledTools(tools, disabledTools), id)
  }

  const [row] = await db.update(mcpServers).set({
    protocolVersion: probe.protocolVersion ?? current.protocolVersion,
    serverInfo: probe.serverInfo ?? current.serverInfo,
    tools,
    disabledTools,
    toolsFetchedAt: now,
    lastCheckedAt: now,
    lastError: null,
    updatedAt: now
  }).where(eq(mcpServers.id, id)).returning()

  return { server: toSummary(row!), probe }
}

// ─────────────────────────────────────────────
// headers 处理
// ─────────────────────────────────────────────

/** 响应脱敏：保留键名，值一律替换为占位符 */
export function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {}
  for (const key of Object.keys(headers)) {
    masked[key] = MCP_HEADER_MASK
  }
  return masked
}

/**
 * 合并提交的 headers 与已存 headers。
 *
 * - 值为占位符 → 保持原值（用户没有改）
 * - 值为空字符串 → 显式清空
 * - 键缺失 → 删除该 header
 */
export function mergeHeaders(
  stored: Record<string, string>,
  incoming: Record<string, string>
): Record<string, string> {
  const merged: Record<string, string> = {}

  for (const [key, value] of Object.entries(incoming)) {
    if (value === MCP_HEADER_MASK) {
      if (stored[key] !== undefined) merged[key] = stored[key]
      continue
    }
    if (value !== '') merged[key] = value
  }

  return merged
}

/** 新建时不应出现占位符（没有「原值」可保留） */
function cleanCreateHeaders(headers: Record<string, string>): Record<string, string> {
  const cleaned: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value !== '' && value !== MCP_HEADER_MASK) cleaned[key] = value
  }
  return cleaned
}

// ─────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────

async function getRow(id: string): Promise<McpServerRow | null> {
  const [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, id)).limit(1)
  return row ?? null
}

/** 全局启用工具总数上限校验（excludeId 用于更新时排除自身） */
async function assertToolQuota(ownCount: number, excludeId: string | null): Promise<void> {
  const rows = await db.select({
    id: mcpServers.id,
    tools: mcpServers.tools,
    disabledTools: mcpServers.disabledTools
  }).from(mcpServers).where(eq(mcpServers.enabled, true))

  let total = ownCount
  for (const row of rows) {
    if (row.id === excludeId) continue
    total += countEnabledTools(row.tools ?? [], row.disabledTools ?? [])
  }

  if (total > MAX_ENABLED_TOOLS) {
    throw new McpConfigError(
      'limit',
      `启用的 MCP 工具总数不能超过 ${MAX_ENABLED_TOOLS} 个（当前将达 ${total} 个）`
    )
  }
}

function countEnabledTools(tools: McpToolSnapshot[], disabledTools: string[]): number {
  return tools.filter(tool => !disabledTools.includes(tool.name)).length
}

/** 只保留仍存在于快照中的工具名（刷新后清理已消失的项） */
function filterDisabledTools(names: string[], tools: McpToolSnapshot[]): string[] {
  const existing = new Set(tools.map(tool => tool.name))
  return [...new Set(names)].filter(name => existing.has(name))
}

function toSummary(row: McpServerRow): McpServerSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    url: row.url,
    headers: maskHeaders(row.headers ?? {}),
    enabled: row.enabled,
    protocolVersion: row.protocolVersion ?? null,
    serverInfo: row.serverInfo ?? null,
    tools: row.tools ?? [],
    disabledTools: row.disabledTools ?? [],
    toolsFetchedAt: row.toolsFetchedAt?.toISOString() ?? null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    lastError: row.lastError ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

function toConfig(row: McpServerRow): McpServerConfig {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    url: row.url,
    headers: row.headers ?? {},
    enabled: row.enabled,
    protocolVersion: row.protocolVersion ?? undefined,
    tools: row.tools ?? [],
    disabledTools: row.disabledTools ?? []
  }
}
