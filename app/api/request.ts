/**
 * 前端 API 层 — 统一 HTTP 封装
 *
 * 职责：
 * 1. 统一 baseURL + 超时
 * 2. 自动拆解后端 { success: true, data } 信封 → 只返回 data
 * 3. 自动将后端 { success: false, error } 转为 ApiError 异常
 *
 * 不负责：
 * - SSE 流式请求（chat 端点用原生 fetch，经 app/api/chat.ts）
 */

// ---- ApiError ----
export class ApiError extends Error {
  code: string
  details?: { path: string, message: string }[]

  constructor(code: string, message: string, details?: { path: string, message: string }[]) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.details = details
  }
}

// ---- apiFetch ----
export default $fetch.create({
  baseURL: '/',
  timeout: 30000,

  // 成功响应：内层 data
  onResponse({ response }) {
    const body = response._data
    // body 形状：{ success: true, data: T }
    // 把 _data 替换成内层 data，上层 $fetch 返回的就是纯净 T
    if (body && typeof body === 'object' && 'success' in body && body.success) {
      response._data = body.data
    }
    // 如果 response.ok 但 body 没有 { success: true } 结构（不应该发生），原样返回
  },

  // 错误响应：抛结构化异常
  async onResponseError({ response }) {
    const body = response._data
    // body 形状：{ success: false, error: { code, message, details? } }
    if (body && typeof body === 'object' && 'error' in body) {
      throw new ApiError(
        body.error.code,
        body.error.message,
        body.error.details
      )
    }
    // 兜底：非标准错误响应（如 HTML 页面、Nginx 502 等）
    throw new ApiError(
      'NETWORK_ERROR',
      `请求失败 (${response.status})`
    )
  }
})
