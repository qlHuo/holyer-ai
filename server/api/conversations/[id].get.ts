/**
 * 获取对话详情 + 历史消息
 *
 * getRouterParam(event, 'id') 是 Nitro 提供的，从文件路径 [id] 提取参数。
 * 消息按 created_at ASC 排序 —— 前端渲染消息历史需要从早到晚。
 * toolCallId ?? undefined：Drizzle 对 nullable varchar 返回 string | null，但 Message 接口定义的是 string | undefined。用 ?? 做转换。
 * as Message['role'] 是类型断言，varchar 在 DB 层是 string，这里窄化为联合类型。比直接 as 安全 —— 至少限定了来源是 Message['role']。
 * */
import { eq, asc } from 'drizzle-orm'
import { db } from '~~/server/db'
import { conversations, messages } from '~~/server/db/schema'
import type { ConversationDetail } from '~~/shared/types/conversation'
import type { Message } from '~~/shared/types/provider'

export default defineEventHandler(async (event): Promise<ConversationDetail> => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'id is required'
    })
  }

  // 获取对话详情
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))

  if (!conversation) {
    throw createError({
      statusCode: 404,
      message: 'Conversation not found'
    })
  }

  // 获取某次对话的历史消息，按时间正序（最早->最新）
  const msgRows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt))

  // 获取消息列表
  const messageList: Message[] = msgRows.map(row => ({
    role: row.role as Message['role'],
    content: row.content,
    toolCalls: row.toolCalls as Message['toolCalls'],
    toolCallId: row.toolCallId ?? undefined
  }))

  return {
    id: conversation.id,
    title: conversation.title,
    model: conversation.model,
    provider: conversation.provider,
    messages: messageList,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString()
  }
})
