/**
 * @Description 全量修改 MCP Server - PUT /api/mcp/servers/:id
 *
 * slug 不参与修改：它参与工具命名，改动会让历史消息中的工具名与当前映射错位。
 */
import type { McpServerSummary } from '~~/shared/types/mcp'
import type { ApiSuccess } from '~~/shared/types/response'
import { assertSafeHttpUrl } from '~~/server/utils/url-safety'
import { updateMcpServer } from '~~/server/service/mcp/servers'
import { successResponse } from '~~/server/utils/response'
import { mcpServerIdSchema, updateMcpServerSchema } from '~~/server/api/mcp/schema'
import { throwMcpConfigError } from '~~/server/service/mcp/http-error'

export default defineEventHandler(async (event): Promise<ApiSuccess<McpServerSummary>> => {
  const id = mcpServerIdSchema.parse(await getRouterParam(event, 'id'))
  const body = updateMcpServerSchema.parse(await readBody(event))

  try {
    assertSafeHttpUrl(body.url, { allowLoopback: import.meta.dev })
    const data = await updateMcpServer(id, body)
    if (!data) {
      throw createError({ statusCode: 404, message: 'MCP Server 不存在' })
    }
    return successResponse(data)
  } catch (error) {
    throwMcpConfigError(error)
  }
})
