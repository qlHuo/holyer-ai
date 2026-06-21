/**
 * 统一 API 响应类型
 *
 * discriminated union — success 字段是字面量，TS 可自动收窄
 */
export type ApiResult<T = unknown> = ApiSuccess<T> | ApiFailure

export interface ApiSuccess<T = unknown> {
  success: true
  data?: T
}

export interface ApiFailure {
  success: false
  error: ApiErrorDetail
}

export interface ApiErrorDetail {
  code: string
  message: string
  details?: { path: string, message: string }[]
}
