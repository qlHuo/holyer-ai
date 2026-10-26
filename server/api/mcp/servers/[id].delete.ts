/**
 * @Description 删除 MCP Server - DELETE /api/mcp/servers/:id
 */
import type { ApiSuccess } from '~~/shared/types/response'
import { deleteMcpServer } from '~~/server/service/mcp/servers'
import { successResponse } from '~~/server/utils/response'
import { mcpServerIdSchema } from '~~/server/api/mcp/schema'

export default defineEventHandler(async (event): Promise<ApiSuccess<boolean>> => {
  const id = mcpServerIdSchema.parse(await getRouterParam(event, 'id'))
  const deleted = await deleteMcpServer(id)

  if (!deleted) {
    throw createError({ statusCode: 404, message: 'MCP Server 不存在' })
  }

  return successResponse(true)
})
