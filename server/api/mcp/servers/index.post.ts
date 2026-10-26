/**
 * @Description 新建 MCP Server - POST /api/mcp/servers
 */
import type { McpServerSummary } from '~~/shared/types/mcp'
import type { ApiSuccess } from '~~/shared/types/response'
import { assertSafeHttpUrl } from '~~/server/utils/url-safety'
import { createMcpServer } from '~~/server/service/mcp/servers'
import { successResponse } from '~~/server/utils/response'
import { createMcpServerSchema } from '~~/server/api/mcp/schema'
import { throwMcpConfigError } from '~~/server/service/mcp/http-error'

export default defineEventHandler(async (event): Promise<ApiSuccess<McpServerSummary>> => {
  const body = createMcpServerSchema.parse(await readBody(event))

  try {
    // 开发环境放行 loopback（本地测试 Server），生产环境一律拦截
    assertSafeHttpUrl(body.url, { allowLoopback: import.meta.dev })
    const data = await createMcpServer(body)
    return successResponse(data)
  } catch (error) {
    throwMcpConfigError(error)
  }
})
