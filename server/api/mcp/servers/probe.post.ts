/**
 * @Description 测试 MCP Server 连通性（不落库）- POST /api/mcp/servers/probe
 *
 * allowLoopback 只在开发环境由服务端开启，绝不接受请求体传入，
 * 否则用户可借探测接口访问内网/环回地址。
 */
import type { ProbeResult } from '~~/shared/types/mcp'
import type { ApiSuccess } from '~~/shared/types/response'
import { probeMcpServer } from '~~/server/service/mcp/probe'
import { getMcpServerConfigById, mergeHeaders } from '~~/server/service/mcp/servers'
import { successResponse } from '~~/server/utils/response'
import { probeMcpServerSchema } from '~~/server/api/mcp/schema'

export default defineEventHandler(async (event): Promise<ApiSuccess<ProbeResult>> => {
  const body = probeMcpServerSchema.parse(await readBody(event))

  // 编辑已有 Server 时，用已存 headers 补齐脱敏占位值。
  // 地址变了就不复用已存密钥——否则改地址即可把旧凭证发到任意主机。
  let headers = body.headers ?? {}
  if (body.serverId) {
    const server = await getMcpServerConfigById(body.serverId)
    if (!server) {
      throw createError({ statusCode: 404, message: 'MCP Server 不存在' })
    }
    headers = server.url === body.url
      ? mergeHeaders(server.headers, headers)
      : mergeHeaders({}, headers)
  }

  const data = await probeMcpServer({
    url: body.url,
    headers,
    allowLoopback: import.meta.dev
  })

  return successResponse(data)
})
