/**
 * Conversation Service 写入操作
 */

import { db } from '~~/server/db'
import type { AddMessageInput, ConversationDetail, CreateConversationInput } from './types'
import { conversations, messages } from '~~/server/db/schema'
import { eq } from 'drizzle-orm'

/**
 * 创建新会话: 返回完整对象
 * .returning() 是 Drizzle PostgreSQL 特性，INSERT 后直接返回插入的行。
*/
export async function createConversation(input: CreateConversationInput): Promise<ConversationDetail> {
  const [row] = await db
    .insert(conversations)
    .values({
      title: input.title || '新对话',
      model: input.model,
      provider: input.provider
    })
    .returning()

  // row 不可能为 undefined（.returning() 保证返回值，除非 DB 连接断）
  return {
    id: row!.id,
    title: row!.title,
    model: row!.model,
    provider: row!.provider,
    messages: [],
    createdAt: row!.createdAt.toISOString(),
    updatedAt: row!.updatedAt.toISOString()
  }
}

/**
 * 删除对话
 *
 * 先查询再删除（区分404和删除成功）
 * 消息由数据库外键 CASCADE 自动删除，不需要手动删除
 *
 * 返回 true 表示删除成功，false 表示对话不存在
*/
export async function deleteConversation(id: string): Promise<boolean> {
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, id))

  if (conversation) {
    // 删除对话
    await db.delete(conversations).where(eq(conversations.id, id))
    return true
  }

  return false
}

/**
 * chat 端点专用：查询或者创建对话 有 ID 则查 + 验证存在，无 ID 则创建
 *
 * 为什么合并？chat 端点里"查或建"是一个原子语义，
 * 拆成两个函数调用会让 handler 里有 if/else 分叉。
 * 合并后 handler 变成一行：
 *   const conv = await getOrCreateConversation(conversationId, { model, provider })
*/
export async function getOrCreateConversation(
  conversationId: string | undefined,
  defaults: { model: string, provider: string }
): Promise<ConversationDetail> {
  // 有id,加载已有对话
  if (conversationId) {
    const { getConversationDetail } = await import('./queries')
    const conv = await getConversationDetail(conversationId)
    if (!conv) {
      throw new Error('NOT FOUND')
    }
    return conv
  }

  // 无ID，创建新对话
  return createConversation({
    title: '新对话',
    model: defaults.model,
    provider: defaults.provider
  })
}

/**
 * 批量添加消息
 *
 * 循环 INSERT Drizzle neon-http 不支持批量插入数据
 * Phase 1 最多插入 2-3 条（用户消息 1-2 条 + assistant 1 条），
 * 循环 IO 不是瓶颈。Phase 2 Agent 引入后如果一轮插入 5+ 条，
 * 再改用 Promise.all 或事务。
 *
 * 注意：toolCallId 用 ?? null 而不是 ?? undefined。
 * Drizzle 中 undefined 语义是"跳过该列"而非"设为 NULL"。
*/
export async function addMessages(
  conversationId: string,
  msgs: AddMessageInput[]
): Promise<void> {
  for (const msg of msgs) {
    try {
      await db.insert(messages).values({
        conversationId,
        role: msg.role,
        content: msg.content,
        toolCallId: msg.toolCallId ?? null,
        toolCalls: msg.toolCalls ?? null
      })
    } catch (error: any) {
      console.error('[addMessages] INSERT failed:', {
        cause: error.cause?.message || error.cause,
        message: error.message,
        code: error.code,
        detail: error.detail,
        hint: error.hint
      })
      throw error
    }
  }

  // 更新对话时间戳
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId))
}
