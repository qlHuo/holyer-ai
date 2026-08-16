/**
 * 工具调用渲染状态（前端 UI 层共享类型）
 *
 * 两个数据源复用同一结构：
 * - 实时流式：SSE TOOL_START / TOOL_END 事件驱动（chat.store 的 agentToolCalls）
 * - 历史渲染：buildRenderItems 从 DB 消息折叠（assistant(tool_calls) + tool 结果）
 *
 * 历史场景没有 running 态，也不记耗时：status 恒为 'done'，durationMs 省略。
 */
export interface AgentToolCallItem {
  id: string
  name: string
  args: string
  status: 'running' | 'done' | 'error'
  result?: string
  durationMs?: number
}
