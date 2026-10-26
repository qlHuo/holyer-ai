/**
 * @Description 局部修改 MCP Server（启停 / 工具级开关）- PATCH /api/mcp/servers/:id
 */
import type { McpServerSummary } from '~~/shared/types/mcp'
import type { ApiSuccess } from '~~/shared/types/response'
import { patchMcpServer } from '~~/server/service/mcp/servers'
import { successResponse } from '~~/server/utils/response'
import { mcpServerIdSchema, patchMcpServerSchema } from '~~/server/api/mcp/schema'
import { throwMcpConfigError } from '~~/server/service/mcp/http-error'

export default defineEventHandler(async (event): Promise<ApiSuccess<McpServerSummary>> => {
  const id = mcpServerIdSchema.parse(await getRouterParam(event, 'id'))
  const body = patchMcpServerSchema.parse(await readBody(event))

  try {
    const data = await patchMcpServer(id, body)
    if (!data) {
      throw createError({ statusCode: 404, message: 'MCP Server 不存在' })
    }
    return successResponse(data)
  } catch (error) {
    throwMcpConfigError(error)
  }
})
