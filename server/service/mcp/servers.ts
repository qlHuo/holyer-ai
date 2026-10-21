/**
 * MCP Server 配置读取与工具加载
 *
 * 当前阶段（4A.2）只用于跑通运行时链路：
 * - 仅开发环境从 NUXT_MCP_DEV_SERVERS 读取 JSON
 * - 生产返回空
 *
 * M3 会替换为 DB 查询，并直接使用持久化的工具快照。
 */

import type { ExecutableTool } from '../agent/tools/types'
import { McpClient } from './client'
import { createMcpTools } from './tool-adapter'
import type { McpServerConfig, McpToolSnapshot } from './types'

export async function getEnabledMcpServers(): Promise<McpServerConfig[]> {
  if (!import.meta.dev) return []

  // Nuxt 会把形如 JSON 的 NUXT_* 环境变量自动解析成对象，
  // 因此这里同时兼容「字符串」与「已解析的数组」两种形态。
  const raw = useRuntimeConfig().mcpDevServers as unknown
  if (!raw) return []

  try {
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return []

    return parsed
      .map(normalizeServer)
      .filter((server): server is McpServerConfig => server !== null)
  } catch {
    return []
  }
}

/**
 * 加载本次对话可用的 MCP 工具。
 *
 * - 快照存在：不发起网络请求
 * - 快照为空（当前开发阶段）：现场 listTools 补齐
 * - 单个 Server 失败只跳过该 Server，不影响对话
 */
export async function loadMcpTools(signal?: AbortSignal): Promise<ExecutableTool[]> {
  const servers = await getEnabledMcpServers()
  const tools: ExecutableTool[] = []

  for (const server of servers) {
    if (!server.enabled) continue

    const client = new McpClient({ url: server.url, headers: server.headers })
    let snapshots = server.tools.filter(tool => !server.disabledTools.includes(tool.name))

    if (snapshots.length === 0) {
      try {
        snapshots = (await client.listTools(signal))
          .filter(tool => !server.disabledTools.includes(tool.name))
      } catch (error) {
        // 开发期不要静默失败，否则“工具没出现”很难排查
        if (import.meta.dev) {
          console.warn(
            `[mcp] 跳过 Server "${server.slug}" (${server.url})：${error instanceof Error ? error.message : '加载工具失败'}`
          )
        }
        continue
      }
    }

    tools.push(...createMcpTools(server, snapshots, client))
  }

  // 开发期把加载结果打到终端，避免“工具没出现”时无从排查
  if (import.meta.dev) {
    console.info(
      `[mcp] Servers=${servers.length}, tools=${tools.map(tool => tool.name).join(', ') || 'none'}, urls=${servers.map(server => server.url).join(', ')}`
    )
  }

  return tools
}

function normalizeServer(value: unknown): McpServerConfig | null {
  if (!isRecord(value)) return null
  if (!isString(value.id) || !isString(value.name) || !isString(value.slug) || !isString(value.url)) {
    return null
  }

  return {
    id: value.id,
    name: value.name,
    slug: value.slug,
    url: value.url,
    headers: normalizeHeaders(value.headers),
    enabled: value.enabled !== false,
    tools: Array.isArray(value.tools) ? value.tools.filter(isToolSnapshot) : [],
    disabledTools: Array.isArray(value.disabledTools)
      ? value.disabledTools.filter(isString)
      : []
  }
}

function normalizeHeaders(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}

  const headers: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (isString(item)) headers[key] = item
  }
  return headers
}

function isToolSnapshot(value: unknown): value is McpToolSnapshot {
  return isRecord(value) && isString(value.name) && isRecord(value.inputSchema)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}
