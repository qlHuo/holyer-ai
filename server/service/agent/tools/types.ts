import type { ToolDefinition } from '~~/shared/types/provider'

// 工具权限
export type ToolPermission = 'readonly' | 'readwrite' | 'dangerous'

// 工具接口 定义
export interface ExecutableTool {
  readonly name: string
  readonly description: string
  readonly permission: ToolPermission
  readonly parameters: Record<string, any>
  execute(args: Record<string, unknown>): string | Promise<string>
  toDefinition(): ToolDefinition
}
