/**
 * 获取所有对话列表
 * 用了两次子查询（count + last message），每条对话多发两次 SQL。
 * sql<number> 是 Drizzle 的类型标注，告诉 TS 这个 raw SQL 返回值是 number。
 * slice(0, 50) 在 JS 层做，不在 SQL 层。简单直接。
*/
import { eq, desc, sql } from 'drizzle-orm'
import { db } from '~~/server/db'
import { conversations, messages } from '~~/server/db/schema'
import type { ConversationListItem } from '~~/shared/types/conversation'

export default defineEventHandler(async (): Promise<ConversationListItem[]> => {
  // 查询所有对话
  const rows = await db.select({
    id: conversations.id,
    title: conversations.title,
    model: conversations.model,
    provider: conversations.provider,
    createdAt: conversations.createdAt,
    updatedAt: conversations.updatedAt
  }).from(conversations).orderBy(desc(conversations.updatedAt))

  // 每条对话，查消息数量和最后一条消息的前 50 字
  const result: ConversationListItem[] = []
  for (const row of rows) {
    const resultCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(eq(messages.conversationId, row.id))

    // 获取最后一条消息的预览数据
    const lastMessage = await db
      .select({
        content: messages.content
      })
      .from(messages)
      .where(eq(messages.conversationId, row.id))
      .orderBy(desc(messages.createdAt))
      .limit(1)

    result.push({
      id: row.id,
      title: row.title,
      model: row.model,
      provider: row.provider,
      messageCount: resultCount[0]?.count || 0,
      lastPreview: lastMessage[0]?.content ? lastMessage[0].content.slice(0, 50) : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    })
  }
  return result
})
