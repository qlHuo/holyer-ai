import type { ApiSuccess, ApiFailure, ApiErrorDetail } from '~~/shared/types/response'

export function successResponse<T>(data?: T): ApiSuccess<T> {
  return {
    success: true,
    data
  }
}

export function errorResponse(
  code: string,
  message: string,
  details?: ApiErrorDetail['details']
): ApiFailure {
  return {
    success: false,
    error: {
      code,
      message,
      details
    }
  }
}
