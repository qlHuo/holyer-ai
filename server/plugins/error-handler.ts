/**
 * 全局错误处理插件，统一错误响应流
 *
 * 通过 Nitro error hook 统一拦截所有 API handler 抛出的错误，
 * 确保始终返回 JSON 格式的错误响应，而非 HTML 错误页。
 *
 * 重要：h3 的 toNodeListener 会把所有非 H3Error 的异常用 createError() 包一层，
 * 原始错误存在 error.cause 里，所以处理前需要先解包。
 *
 * 三层错误分类：
 * - ZodError       → 400 + 字段级校验详情
 * - H3Error        → 保持原 statusCode + 统一格式
 * - 未知 Error      → 500 + 通用内部错误消息（生产环境不泄露细节）
 */
import { ZodError } from 'zod'
import type { H3Error } from 'h3'
import { isError, setResponseHeader, setResponseStatus, send } from 'h3'
import { errorResponse } from '~~/server/utils/response'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error, context) => {
    // H3 的请求事件对象
    const event = context.event
    // 忽略非 API handler 抛出的错误
    if (!event) return

    // 用 H3 的响应方法写 header 和 body
    setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8')

    // 解包：h3 会把所有非 H3Error 用 createError() 包一层，原始错误在 .cause 里
    const unwrapped = isError(error) ? error.cause : error

    // 按错误类型分发 —— ZodError 是 Zod 抛的，H3Error 是 H3 抛的
    if (unwrapped instanceof ZodError) {
      handleZodError(unwrapped, event)
    } else if (isError(error)) {
      handleH3Error(error, event)
    } else {
      handleUnknownError(error, event)
    }
  })
})

/**
 * Zod 错误处理 - 400 + 字段级校验详情
 * 把 Zod 的扁平 errors 数组转成对前端友好的字段级
*/
function handleZodError(error: ZodError, event: any) {
  setResponseStatus(event, 400)
  const errorRes = JSON.stringify(
    errorResponse(
      'VALIDATION_ERROR',
      '请求参数校验失败',
      error.issues.map(e => ({
        path: e.path.join('.'),
        message: e.message
      })))
  )
  // 统一错误格式
  send(event, errorRes)
}

/**
 * H3Error（createError 抛出的） → 保持原状态码
 */
function handleH3Error(error: H3Error, event: any) {
  setResponseStatus(event, error.statusCode)
  const errorRes = JSON.stringify(
    errorResponse(statusToCode(error.statusCode), error.message)
  )
  // 统一错误格式

  send(event, errorRes)
}

/**
 * 未知 Error（数据库挂了、LLM API 超时等未预期的） → 500
 * 开发环境返回堆栈，生产环境只返回通用消息
 */
function handleUnknownError(error: unknown, event: any) {
  setResponseStatus(event, 500)
  const errorRes = JSON.stringify(
    errorResponse('INTERNAL_ERROR', import.meta.dev
      ? (error instanceof Error ? error.message : String(error))
      : '服务器内部错误，请稍后重试'
    )
  )
  send(event, errorRes)
}

/** 状态码 → 语义化错误码 */
function statusToCode(statusCode: number): string {
  switch (statusCode) {
    case 400: return 'BAD_REQUEST'
    case 401: return 'UNAUTHORIZED'
    case 404: return 'NOT_FOUND'
    case 409: return 'CONFLICT'
    case 422: return 'UNPROCESSABLE_ENTITY'
    case 429: return 'TOO_MANY_REQUESTS'
    default: return 'ERROR'
  }
}
