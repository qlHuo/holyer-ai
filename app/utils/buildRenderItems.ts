import type { Message } from '#shared/types/provider'
import type { AgentToolCallItem } from '~/types/agent'

/**
 * 渲染单元
 * - user: 用户消息
 * - assistant: 助手回复（可能附带折叠后的工具调用列表）
 */
export type RenderItem
  = | { kind: 'user', message: Message }
    | { kind: 'assistant', message: Message, tools?: AgentToolCallItem[] }

/**
 * 把 DB 消息折叠成渲染单元。
 *
 * 后端一次工具调用落库为三行：
 *   assistant(tool_calls) → tool(result) → assistant(text)
 * 直接 v-for 会渲染出两个空气泡。这里把「一个 user 回合之后、
 * 下一个 user 之前的」所有 assistant/tool 折叠成一个 assistant 单元：
 * - 中间轮 assistant(tool_calls) 的 toolCalls 累积进 tools
 * - role='tool' 的 content 回填到对应 tools[].result（靠 tool_call_id 匹配）
 * - 最终 assistant(text) 作为 message.content
 *
 * 多轮工具调用（一个 user 回合内多次 ReAct 循环）自然累积到同一单元。
 */
export function buildRenderItems(messages: Message[]): RenderItem[] {
  const items: RenderItem[] = []
  let i = 0

  while (i < messages.length) {
    const msg = messages[i]!

    // 用户消息：直接渲染
    if (msg.role === 'user') {
      items.push({ kind: 'user', message: msg })
      i++
      continue
    }

    // 助手消息：收集到下一个 user 之前的所有工具调用 + 最终文本
    if (msg.role === 'assistant') {
      const tools: AgentToolCallItem[] = []
      let finalAssistant: Message = msg
      let j = i

      while (j < messages.length && messages[j]!.role !== 'user') {
        const m = messages[j]!
        if (m.role === 'assistant') {
          if (m.toolCalls?.length) {
            // 中间轮 assistant(tool_calls)：累积调用，结果稍后回填
            for (const tc of m.toolCalls) {
              tools.push({ id: tc.id, name: tc.name, args: tc.arguments, status: 'done' })
            }
          } else {
            // 最终 assistant(text)
            finalAssistant = m
          }
        } else if (m.role === 'tool') {
          // 结果回填到匹配的调用
          const target = tools.find(tc => tc.id === m.toolCallId)
          if (target) target.result = m.content
        }
        j++
      }

      items.push({
        kind: 'assistant',
        message: finalAssistant,
        tools: tools.length ? tools : undefined
      })
      i = j
      continue
    }

    // 孤立的 tool / system：跳过（正常数据不会出现）
    i++
  }

  return items
}
