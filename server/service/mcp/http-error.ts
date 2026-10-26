import { createError } from 'h3'
import { UnsafeUrlError } from '~~/server/utils/url-safety'
import { McpConfigError } from './errors'

/**
 * 把 MCP 配置层领域错误转成 HTTP 400。
 *
 * 路由只做参数校验与响应包装；「数量超限 / slug 重复 / 地址不安全」
 * 属于 MCP 业务语义，放在 service/mcp 下，避免 server/utils 反向依赖业务层。
 * 其它错误原样抛出，交给全局错误中间件。
 */
export function throwMcpConfigError(error: unknown): never {
  if (error instanceof UnsafeUrlError || error instanceof McpConfigError) {
    throw createError({ statusCode: 400, message: error.message })
  }
  throw error
}
