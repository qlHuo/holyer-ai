import type { McpErrorKind } from './types'

export class McpError extends Error {
  constructor(
    readonly kind: McpErrorKind,
    message: string,
    readonly meta: { status?: number, code?: number, detail?: unknown } = {}
  ) {
    super(message)
    this.name = 'McpError'
  }
}

/**
 * MCP 工具执行失败（tools/call 返回 isError）
 *
 * 与 McpError 区分：这是工具业务失败，结果应回填给模型，而不是中断对话。
 * runner 捕获后标记 success=false，并直接使用 message 作为工具结果。
 */
export class McpToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpToolError'
  }
}
