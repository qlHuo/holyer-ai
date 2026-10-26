/**
 * @Description MCP Server 列表 - GET /api/mcp/servers
 */
import type { McpServerSummary } from '~~/shared/types/mcp'
import type { ApiSuccess } from '~~/shared/types/response'
import { getMcpServerList } from '~~/server/service/mcp/servers'
import { successResponse } from '~~/server/utils/response'

export default defineEventHandler(async (): Promise<ApiSuccess<McpServerSummary[]>> => {
  const data = await getMcpServerList()
  return successResponse(data)
})
