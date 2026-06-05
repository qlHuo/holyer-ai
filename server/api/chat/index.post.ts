/**
* ① 前端 POST → 后端收到 { provider, model, message, conversationId? }
* ② 有 conversationId？
*    YES → 查 DB 拿到 convId + 历史消息
*    NO  → INSERT 新对话，拿到 convId
* ③ INSERT 用户消息到 messages 表
*    为什么先存？LLM 调用失败消息也不丢
* ④ UPDATE conversations.updated_at
* ⑤ 拼装上下文：[历史消息...] + [当前用户消息...]
* ⑥ SSE 流开始 → 立即发 meta 事件
*    data: {"type":"meta","conversationId":"uuid"}
*    前端收到后立即更新 URL 和侧边栏
* ⑦ provider.chat(allMessages) → ReadableStream
*    逐 token 推 text 事件 + 拼 contentBuffer
*    ↓ 这里不能写库！每秒 50 次 token
* ⑧ 流结束 → 一次性 INSERT assistant 消息到库
*    contentBuffer → messages.content
* ⑨ 发 done 事件
*    data: {"type":"done","conversationId":"uuid","messageId":"uuid"}
* ⑩ 如果 LLM 调用本身失败 → 只发 error 事件，不写库
*/
import { eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { conversations, messages } from '~~/server/db/schema'
import { createLLMProvider } from '~~/server/service/llm/factory'
// import { createSSEResponse } from '~~/server/utils/sse'

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

  // 解析conversation 获取已有/新会话
  let convId: string = conversationId || ''
  let historyMessages: Message[] = []

  if (conversationId) {
    // 根据传入的会话id查询会话详情数据
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))

    if (!conversation) {
      throw createError({
        status: 404,
        message: '会话不存在'
      })
    }

    // 使用查询的数据更新convId
    convId = conversation.id

    // 获取历史消息，作为上下文
    const historyRows = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convId))
      .orderBy(messages.createdAt)

    historyMessages = historyRows.map(row => ({
      role: row.role as Message['role'],
      content: row.content,
      toolCalls: row.toolCalls as Message['toolCalls'],
      toolCallId: row.toolCallId ?? undefined
    }))
  } else {
    // 自动创建新会话
    const [newConversation] = await db
      .insert(conversations)
      .values({
        title: '新对话',
        model,
        provider
      }).returning()

    if (!newConversation) {
      throw createError({
        status: 500,
        message: '创建会话失败'
      })
    }
    convId = newConversation.id
  }

  // 保存用户发送的消息
  for (const msg of message) {
    await db
      .insert(messages)
      .values({
        conversationId: convId,
        role: msg.role,
        content: msg.content,
        toolCalls: msg.toolCalls,
        toolCallId: msg.toolCallId ?? undefined
      })
  }

  // 更新会话信息
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, convId))

  const allMessages = [...historyMessages, ...message]
  // 创建 LLM Provider
  const llmProvider = createLLMProvider(provider)

  let isClosed = false
  if (event.node?.req) {
    event.node.req.on('close', () => {
      isClosed = true
    })
  }

  const encoder = new TextEncoder()

  // 发送meta事件的辅助函数
  function enqueueMeta(controller: ReadableStreamDefaultController, payload: Record<string, unknown>) {
    if (!isClosed) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'meta', ...payload })}\n\n`))
    }
  }

  // 发送text的辅助函数
  function enqueueText(controller: ReadableStreamDefaultController, content: string) {
    if (!isClosed) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', content })}\n\n`))
    }
  }

  // 发送 done 的辅助函数
  function enqueueDone(controller: ReadableStreamDefaultController, payload: Record<string, unknown>) {
    if (!isClosed) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', ...payload })}\n\n`))
    }
  }

  // 发送 error 事件的辅助函数
  function enqueueError(controller: ReadableStreamDefaultController, content: string) {
    if (!isClosed) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', content })}\n\n`))
    }
  }

  // Provider.chat() 返回 ReadableStream<string>（纯文本 token 流）
  // const llmStream = await llmProvider.chat(message, {
  //   model,
  //   tools,
  //   systemPrompt,
  //   temperature,
  //   maxTokens
  // })
  // // 包装为 SSE Response → 浏览器逐 token 消费
  // return createSSEResponse(llmStream, event)

  const stream = new ReadableStream({
    async start(controller) {
      // 立即发送 meta 事件
      enqueueMeta(controller, {
        conversationId: convId
      })

      // 心跳
      const heartbeat = setInterval(() => {
        if (isClosed) {
          clearInterval(heartbeat)
          return
        }
        controller.enqueue(encoder.encode('event: ping\ndata: {}\n\n'))
      }, 1000 * 30)

      try {
        // 调用LLM 获取流
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
          if (done || isClosed) break
          contentBuffer += value
          enqueueText(controller, contentBuffer)
        }

        // 流正常结束 → 保存 assistant 消息
        if (!isClosed && contentBuffer) {
          const [saved] = await db.insert(messages).values({
            conversationId: convId,
            role: 'assistant',
            content: contentBuffer
          }).returning()

          // 再更新会话信息
          await db
            .update(conversations)
            .set({ updatedAt: new Date() })
            .where(eq(conversations.id, convId))

          enqueueDone(controller, {
            conversationId: convId,
            messageId: saved?.id ?? null
          })
        } else if (!isClosed) {
          enqueueDone(controller, {
            conversationId: convId,
            messageId: null
          })
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'LLM 调用失败'
        enqueueError(controller, errorMessage)
      } finally {
        clearInterval(heartbeat)
        controller.close()
      }
    },

    cancel() {
      isClosed = true
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  })
})
