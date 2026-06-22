/**
 * SSE 流式对话
 *
 * 流程：
 * 1. getOrCreateConversation  获取对话/新建对话
 * 2. 保存用户信息，发送的信息
 * 3. 调用LLM
 * 4. 构建 SSEChunk 事件流，交给createSSEResponse工具处理
*/
import { addMessages, deleteLastAssistantMessage, getOrCreateConversation, updateConversationById } from '~~/server/service/conversation'
import { createLLMProvider } from '~~/server/service/llm/factory'
import type { SSEChunk } from '~~/server/utils/sse'
import type { ConversationDetail } from '~~/shared/types/conversation'
import { createSSEResponse } from '~~/server/utils/sse'
import { ChatBodySchema } from './schema'
import { SSE_EVENT } from '~~/shared/types/sse'

export default defineEventHandler(async (event) => {
  const body = ChatBodySchema.parse(await readBody(event))
  const {
    provider,
    model,
    message,
    regenerate,
    conversationId, // 创建新会话时为空
    tools,
    systemPrompt,
    temperature,
    maxTokens
  } = body

  // 1. 获取/创建对话
  let conv: ConversationDetail
  try {
    conv = await getOrCreateConversation(conversationId, { model, provider })
  } catch (error: any) {
    if (error?.message === 'NOT FOUND') {
      throw createError({ statusCode: 404, message: '会话不存在' })
    }
    throw error
  }

  // 首条消息 → 用消息内容作为标题（覆盖「新建对话」时写入的默认标题）
  const isFirstMessage = conv.messages.length === 0
  const title = isFirstMessage
    ? (message[0]?.content?.slice(0, 50) || '新对话')
    : conv.title

  // 2. 保存用户信息（调用LLM之前，宁可多存不丢）
  // regenerate 为 true 时用户消息已在 DB 中，不重复写入
  if (!regenerate) {
    await addMessages(conv.id, message)
  }

  // 3. 拼装上下文：历史 + 当前用户信息
  let allMessages: typeof conv.messages
  if (regenerate) {
    // 去掉最后一条旧的 assistant 回复，LLM 不应看到它
    const msgs = [...conv.messages]
    if (msgs[msgs.length - 1]?.role === 'assistant') {
      msgs.pop()
    }
    allMessages = msgs
  } else {
    allMessages = [...conv.messages, ...message]
  }

  // 4. 创建 LLM Provider
  const llmProvider = createLLMProvider(provider)

  // 5. 构建SSE事件流
  const eventStream = new ReadableStream<SSEChunk>({
    async start(controller) {
      // 立即发meta 事件，前端获取conversationId，title
      controller.enqueue({ type: SSE_EVENT.META, conversationId: conv.id, title })

      // 首条消息 → 更新 DB 标题（在流开始前完成，确保 refreshConversationInList 读到新标题）
      if (isFirstMessage) {
        try {
          await updateConversationById(conv.id, { title })
        } catch {
          // 标题更新失败不阻塞对话
        }
      }

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
          if (done) break

          contentBuffer += value
          controller.enqueue({ type: SSE_EVENT.TEXT, content: value })
        }

        // 流结束，存assistant消息
        if (contentBuffer) {
          if (regenerate) {
            // 删除旧 assistant + 插入新 assistant
            await deleteLastAssistantMessage(conv.id)
            await addMessages(conv.id, [{ role: 'assistant', content: contentBuffer }])
          } else {
            await addMessages(conv.id, [{ role: 'assistant', content: contentBuffer }])
          }
        }

        controller.enqueue({
          type: SSE_EVENT.DONE,
          conversationId: conv.id
        })
      } catch (error) {
        controller.enqueue({
          type: SSE_EVENT.ERROR,
          content: error instanceof Error ? error.message : 'LLM调用失败'
        })
      } finally {
        controller.close()
      }
    }
  })

  return createSSEResponse(eventStream, event)
})
