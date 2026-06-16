/**
 * Conversation Service - 只读操作
 *
 *  每个函数返回的类型是前后端共享的 API 契约类型
 * （ConversationListItem / ConversationDetail），
 * 而不是 Drizzle 的原始行类型 —— 这样 API 路由不需要做类型转换。
*/
import { db } from '~~/server/db'
import { conversations, messages } from '~~/server/db/schema'
import { asc, desc, eq, sql } from 'drizzle-orm'
import type { ConversationListItem, ConversationDetail } from './types'
import type { Message } from '~~/shared/types/provider'

/**
 * @Description 查询会话列表
 */
export async function getConversationList(): Promise<ConversationListItem[]> {
  /**
   * 注意：Drizzle 的 sql 模板在子查询中引用外层表的列时，
   * ${conversations.id} 可能被参数化为 $1 而非内联为列引用，
   * 导致关联子查询失效（messageCount=0, lastPreview=null）。
   *
   * 解决方案：使用 raw SQL 字符串写关联条件，
   * 外层表的列名用原始字符串（"conversations"."id"），
   * 内层表的引用仍用 Drizzle 列对象（确保类型安全的重命名）。
   */
  const rows = await db.select({
    id: conversations.id,
    title: conversations.title,
    model: conversations.model,
    provider: conversations.provider,
    createdAt: conversations.createdAt,
    updatedAt: conversations.updatedAt,
    messageCount: sql<number>`(
          SELECT count(*)::int FROM ${messages}
          WHERE ${messages.conversationId} = "conversations"."id"
        )`,
    lastPreview: sql<string | null>`(
        SELECT ${messages.content}
        FROM ${messages}
        WHERE ${messages.conversationId} = "conversations"."id"
        ORDER BY ${messages.createdAt} DESC
        LIMIT 1
      )`
  })
    .from(conversations)
    .orderBy(desc(conversations.updatedAt))

  return rows.map(row => ({
    id: row.id,
    title: row.title,
    model: row.model,
    provider: row.provider,
    messageCount: row.messageCount,
    lastPreview: row.lastPreview ? row.lastPreview.slice(0, 50) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }))
}

/**
 * @Description 获取单个对话
 * 如果不存在返回null, 由调用方决定是否抛404
 */
export async function getConversation(id: string) {
  const [rows] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))

  return rows ?? null
}

/**
 * @Description 获取对话的完整消息历史（按时间正序，最早-最新）
 */
export async function getHistory(conversationId: string): Promise<Message[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt))

  return rows.map(row => ({
    role: row.role as Message['role'],
    content: row.content,
    toolCalls: (row.toolCalls as Message['toolCalls']) ?? undefined,
    toolCallId: row.toolCallId ?? undefined
  }))
}

/**
 * @Description 获取对话详情（对话信息 + 消息列表） - getConversation + getHistory 组合
 * 如果对话不存在，返回 null。
 * API 路由拿到 null 后抛 404。
 */
export async function getConversationDetail(id: string): Promise<ConversationDetail | null> {
  // getConversation 和 getHistory 互不依赖，并行查询
  const [conversation, messageList] = await Promise.all([
    getConversation(id),
    getHistory(id)
  ])
  if (!conversation) return null

  return {
    id: conversation.id,
    title: conversation.title,
    model: conversation.model,
    provider: conversation.provider,
    messages: messageList,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString()
  }
}
