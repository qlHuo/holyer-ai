/**
 * @Description 刷新工具快照 - POST /api/mcp/servers/:id/refresh
 *
 * 失败时保留旧快照，只更新 lastError，返回的 probe.ok 为 false。
 */
import type { McpRefreshResult } from '~~/shared/types/mcp'
import type { ApiSuccess } from '~~/shared/types/response'
import { refreshMcpServer } from '~~/server/service/mcp/servers'
import { successResponse } from '~~/server/utils/response'
import { mcpServerIdSchema } from '~~/server/api/mcp/schema'
import { throwMcpConfigError } from '~~/server/service/mcp/http-error'

export default defineEventHandler(async (event): Promise<ApiSuccess<McpRefreshResult>> => {
  const id = mcpServerIdSchema.parse(await getRouterParam(event, 'id'))

  try {
    const data = await refreshMcpServer(id)
    if (!data) {
      throw createError({ statusCode: 404, message: 'MCP Server 不存在' })
    }
    return successResponse(data)
  } catch (error) {
    throwMcpConfigError(error)
  }
})
