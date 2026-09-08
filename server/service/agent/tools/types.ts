import type { ToolContext, ToolDefinition } from '~~/shared/types/provider'

// 工具权限
export type ToolPermission = 'readonly' | 'readwrite' | 'dangerous'

// 工具接口 定义
export interface ExecutableTool {
  readonly name: string
  readonly description: string
  readonly permission: ToolPermission
  readonly parameters: Record<string, any>
  /**
   * 执行工具
   * @param args   LLM 构造的参数（JSON.parse 后的对象）
   * @param signal 取消信号（客户端断开 + Agent 超时合并）
   * @param ctx    会话级工具上下文（见 shared/types/provider.ts ToolContext）——大多数工具可忽略，
   *               需要"会话级"配置（如知识库检索范围）的工具从中读取
   */
  execute(args: Record<string, unknown>, signal?: AbortSignal, ctx?: ToolContext): string | Promise<string>
  toDefinition(): ToolDefinition
}
