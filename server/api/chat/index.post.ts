/**
 * SSE 流式对话
 *
 * 流程：
 * 1. getOrCreateConversation  获取对话/新建对话
 * 2. 保存用户信息，发送的信息
 * 3. 调用LLM
 * 4. 构建 SSEChunk 事件流，交给createSSEResponse工具处理
*/
import { addMessages, getOrCreateConversation } from '~~/server/service/conversation'
import { createLLMProvider } from '~~/server/service/llm/factory'
import type { SSEChunk } from '~~/server/utils/sse'
import type { ConversationDetail } from '~~/shared/types/conversation'
import { createSSEResponse } from '~~/server/utils/sse'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const {
    provider,
    model,
    message,
    conversationId, // 创建新会话时为空
    tools,
    systemPrompt,
    temperature,
    maxTokens
  } = body

  // 参数校验
  if (!provider || !model || !message?.length) {
    throw createError({
      status: 400,
      message: '缺少必要参数：provider, model, messages'
    })
  }

  // 1. 获取/创建对话
  let conv: ConversationDetail
  try {
    conv = await getOrCreateConversation(conversationId, { model, provider })
  } catch (error: any) {
    if (error?.message === 'NOT FOUND') {
      throw createError({ status: 404, message: '会话不存在' })
    }
    throw error
  }

  // 2. 保存用户信息（调用LLM之前，宁可多存不丢）
  await addMessages(conv.id, message)

  // 3. 拼装上下文：历史 + 当前用户信息
  const allMessages = [...conv.messages, ...message]

  // 4. 创建 LLM Provider
  const llmProvider = createLLMProvider(provider)

  // 5. 构建SSE事件流
  const eventStream = new ReadableStream<SSEChunk>({
    async start(controller) {
      // 立即发meta 事件，前端获取conversationId
      controller.enqueue({ type: 'meta', conversationId: conv.id })

      try {
        const llmStream = await llmProvider.chat(allMessages, {
          model,
          tools,
          systemPrompt,
          temperature,
          maxTokens
        })

        const reader = llmStream.getReader()
        let contentBuffer = ''

        while (true) {
          const { done, value } = await reader.read()
          console.log('done, value***', done, value)
          if (done) break

          contentBuffer += value
          controller.enqueue({ type: 'text', content: value })
        }

        // 流结束，存assistant消息
        if (contentBuffer) {
          await addMessages(conv.id, [
            { role: 'assistant', content: contentBuffer }
          ])
        }

        controller.enqueue({
          type: 'done',
          conversationId: conv.id
        })
      } catch (error) {
        controller.enqueue({
          type: 'error',
          content: error instanceof Error ? error.message : 'LLM调用失败'
        })
      } finally {
        controller.close()
      }
    }
  })

  return createSSEResponse(eventStream, event)
})
