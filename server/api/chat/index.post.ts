/**
 * SSE 流式对话
 *
 * 流程：
 * 1. getOrCreateConversation  获取对话/新建对话
 * 2. 保存用户信息，发送的信息
 * 3. 调用LLM
 * 4. 构建 SSEChunk 事件流，交给createSSEResponse工具处理
 *
 * 关键设计逻辑：
 * 1. 所有的SSE事件都要携带 conversationId，前端据此将事件路由到正确的对话，支持多路会话并行流
 * 2. AbortSignal 用于取消 LLM API 调用，前端可取消对话
 * 3. 增量写入DB, 保证中途断开也不会丢失已接收的数据
*/
import { addMessages, deleteLastAssistantMessage, getOrCreateConversation, updateConversationById, insertMessage, updateMessage
} from '~~/server/service/conversation'
import { createLLMProvider } from '~~/server/service/llm/factory'
import type { SSEChunk } from '~~/server/utils/sse'
import type { ConversationDetail } from '~~/shared/types/conversation'
import { createSSEResponse } from '~~/server/utils/sse'
import { ChatBodySchema } from './schema'
import { SSE_EVENT } from '~~/shared/types/sse'
import { filterTextChunks } from '~~/server/utils/stream'
import { runAgentLoop } from '~~/server/service/agent/runner'
import { toolRegistry } from '~~/server/service/agent/tools'

export default defineEventHandler(async (event) => {
  const body = ChatBodySchema.parse(await readBody(event))
  const {
    model,
    message,
    regenerate,
    conversationId, // 创建新会话时为空
    systemPrompt,
    temperature,
    maxTokens
  } = body

  // 1. 获取/创建对话
  let conv: ConversationDetail
  try {
    conv = await getOrCreateConversation(conversationId, { model })
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
  const llmProvider = createLLMProvider()

  // 创建 AbortController — 用于取消底层 LLM API 调用
  // 当客户端断开连接时，req.on('close') 触发 → abort() → signal 传给 Provider
  const llmAbortController = new AbortController()

  // 5. 构建SSE事件流
  const eventStream = new ReadableStream<SSEChunk>({
    async start(controller) {
      // 立即发meta 事件，前端获取conversationId，title
      controller.enqueue({ type: SSE_EVENT.META, conversationId: conv.id, title })

      // 监听取消请求
      // 1. 标记 isCancelled
      // 2. abort LLM API 调用，底层fetch被真正取消
      let isCancelled = false
      event.node?.req?.on('close', () => {
        isCancelled = true
        llmAbortController.abort()
      })

      // 首条消息 → 更新 DB 标题（在流开始前完成，确保 refreshConversationInList 读到新标题）
      if (isFirstMessage) {
        try {
          await updateConversationById(conv.id, { title })
        } catch {
          // 标题更新失败不阻塞对话
        }
      }

      try {
        // 必须要在LLM前删除并插入空message,原因在于llmProvider.chat当它 return ReadableStream 时，HTTP 响应体已经在接收数据，数据持续写入内部缓冲增加延迟
        if (regenerate) {
          await deleteLastAssistantMessage(conv.id)
        }
        // 插入空消息
        const newMsg = await insertMessage(conv.id, { role: 'assistant', content: '' })

        const toolDefinitions = toolRegistry.getDefinitions()

        // 有工具可用时，追加工具调用准则到 system prompt（防止 LLM 对"你好"也调工具）
        const now = new Date()
        const dateContext = `
          ## 当前时间
          今天是 ${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日（周${['日', '一', '二', '三', '四', '五', '六'][now.getDay()]}），当前时间是 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}（北京时间 UTC+8）。
          搜索实时信息时，请使用上述日期作为参考，不要使用过期的年份。
        `

        const toolUsageGuidelines = `
          ## 工具调用准则
          你可以使用工具来辅助回答问题。遵守以下规则：
          - 只有问题涉及实时信息、具体计算、日期时间或需要获取特定网页内容时才调用工具
          - 日常问候、闲聊、常识性问题不要调用工具，直接回答即可
          - 如果不确定是否需要工具，就不要调用——先尝试直接回答
        `

        const effectiveSystemPrompt = toolDefinitions.length > 0
          ? [systemPrompt, dateContext, toolUsageGuidelines].filter(Boolean).join('\n\n')
          : systemPrompt

        const chatOptions = {
          model,
          systemPrompt: effectiveSystemPrompt,
          temperature,
          maxTokens,
          signal: llmAbortController.signal
        }

        let contentBuffer = ''
        let lastFlushLength = 0

        if (toolDefinitions.length > 0) {
          // ─── Agent 路径：AsyncGenerator<AgentEvent> → SSE ───
          const eventStream = runAgentLoop(llmProvider, allMessages, chatOptions)

          for await (const event of eventStream) {
            if (isCancelled) break

            switch (event.type) {
              case 'round_start':
                controller.enqueue({
                  type: SSE_EVENT.ROUND_START,
                  round: event.round,
                  conversationId: conv.id
                })
                break

              case 'tool_start':
                controller.enqueue({
                  type: SSE_EVENT.TOOL_START,
                  toolName: event.toolName,
                  toolCallId: event.toolCallId,
                  args: event.arguments,
                  conversationId: conv.id
                })
                break

              case 'tool_end':
                controller.enqueue({
                  type: SSE_EVENT.TOOL_END,
                  toolName: event.toolName,
                  toolCallId: event.toolCallId,
                  result: event.result,
                  success: event.success,
                  conversationId: conv.id
                })
                break

              case 'text':
                // 最后一轮文本 → 增量写入 DB（同纯聊天路径）
                contentBuffer += event.content
                controller.enqueue({
                  type: SSE_EVENT.TEXT,
                  content: event.content,
                  conversationId: conv.id
                })
                if (contentBuffer.length - lastFlushLength >= 200) {
                  await updateMessage(newMsg.id, { content: contentBuffer })
                  lastFlushLength = contentBuffer.length
                }
                break

              case 'error':
                controller.enqueue({
                  type: SSE_EVENT.ERROR,
                  content: event.message,
                  conversationId: conv.id
                })
                break

              case 'done':
                break
            }
          }
        } else {
          // ─── 纯聊天路径（零工具注册时）：现有逻辑不变 ───
          const rawStream = await llmProvider.chat(allMessages, chatOptions)
          const llmStream = filterTextChunks(rawStream)

          const reader = llmStream.getReader()

          while (true) {
            if (isCancelled) {
              controller.close()
              break
            }

            const { done, value } = await reader.read()
            if (done) break

            contentBuffer += value
            controller.enqueue({ type: SSE_EVENT.TEXT, content: value, conversationId: conv.id })
            if (contentBuffer.length - lastFlushLength >= 200) {
              await updateMessage(newMsg.id, { content: contentBuffer })
              lastFlushLength = contentBuffer.length
            }
          }
        }

        // 流结束，最终保存 assistant 消息
        if (contentBuffer) {
          await updateMessage(newMsg.id, { content: contentBuffer })
        }

        // 正常结束 → DONE
        if (!isCancelled) {
          controller.enqueue({
            type: SSE_EVENT.DONE,
            conversationId: conv.id
          })
        }
      } catch (error) {
        // 用户中断请求
        if (error instanceof Error && error.name === 'AbortError') {
          return
        }
        if (!isCancelled) {
          controller.enqueue({
            type: SSE_EVENT.ERROR,
            content: error instanceof Error ? error.message : 'LLM调用失败',
            conversationId: conv.id
          })
        }
      } finally {
        controller.close()
      }
    }
  })

  return createSSEResponse(eventStream, event)
})
