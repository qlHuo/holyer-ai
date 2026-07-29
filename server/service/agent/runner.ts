/**
 * Agent runner - ReAct 循环核心
 *
 * 职责：接收消息列表，循环调用LLM，检测到 tool_calls 时自动执行工具并将结果回传，知道 LLM 不再调用工具给出最终文本回复或者超过最大迭代数
 *
 * 返回 ReadableStream<LLMStreamChunk> 与 provider.chat() 返回的流一致，直接对接 filterTextChunks
 *
 * Agent 工具系统实现详解梳理：docs\dev-log\2026-07-29-agent-tool-system-implementation.md
 *
*/

import type { Message, ToolCall, LLMStreamChunk, ChatOptions } from '~~/shared/types/provider'
import type { LLMProvider } from '~~/server/service/llm/types'
import { toolRegistry } from './tools'

// 工具迭代次数限制
const MAX_ITERATIONS = 10

/**
 * 执行 Agent ReAct 循环
 *
 * @param provider - LLMPRrovider 实例
 * @param messages - 消息列表
 * @param options - 聊天选项（model、tools、systemPrompt、maxTokens、temperature、signal）
 * @returns ReadableStream<LLMStreamChunk> - 最终响应流（包含 type: 'text' + type: 'done'）
*/
export async function runAgentLoop(
  provider: LLMProvider,
  messages: Message[],
  options: ChatOptions & { signal?: AbortSignal }
): Promise<ReadableStream<LLMStreamChunk>> {
  // 浅拷贝消息列表，避免污染调用方的原始数据
  const conversationMessages: Message[] = messages.map(m => ({
    ...m,
    toolCalls: m.toolCalls ? [...m.toolCalls] : undefined
  }))

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    // Abort 检查
    if (options.signal?.aborted) {
      return textStream('消息已取消')
    }

    // 1. 调用LLM
    const stream = await provider.chat(conversationMessages, options)

    // 2. 读取完成所有的chunk
    const textParts: string[] = []
    const toolCalls: ToolCall[] = []

    const reader = stream.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value.type === 'text') {
          textParts.push(value.content)
        } else if (value.type === 'tool_calls') {
          toolCalls.push(...value.toolCalls)
        }
        // type === 'done' 忽略，由外层 while 的 done 处理
      }
    } finally {
      reader.releaseLock()
    }

    // 3. 没有工具调用，返回最终文本
    if (toolCalls.length === 0) {
      return textStream(textParts.join(''))
    }

    // 4. 将 assistant 消息，写入对话历史，包含tool_calls
    conversationMessages.push({
      role: 'assistant',
      content: textParts.join(''),
      toolCalls
    })

    // 5. 执行每个工具，结果写回对话历史
    const registered = toolRegistry.list().map(t => t.name)
    for (const tc of toolCalls) {
      let result: string
      try {
        const tool = toolRegistry.get(tc.name)
        if (!tool) {
          result = `错误：工具"${tc.name}"未注册，已注册工具：[${registered.join(', ')}]`
        } else {
          const args = JSON.parse(tc.arguments) as Record<string, unknown>
          result = await tool.execute(args)
        }
      } catch (error) {
        result = `工具执行异常： ${error instanceof Error ? error.message : '未知错误'}`
      }
      conversationMessages.push({
        role: 'tool',
        content: result,
        toolCallId: tc.id
      })
    }

    // 6. 继续迭代下一轮，LLM 看到结果后决定下一步
  }

  return textStream('已经达到工具调用次数上限，请简化提问后重试')
}

// 将纯文本包裹成标准 LLMStreamChunk 流
function textStream(content: string): ReadableStream<LLMStreamChunk> {
  return new ReadableStream<LLMStreamChunk>({
    start(controller) {
      if (content) {
        controller.enqueue({ type: 'text', content })
      }
      controller.enqueue({ type: 'done' })
      controller.close()
    }
  })
}
