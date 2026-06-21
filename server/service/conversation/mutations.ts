/**
 * Conversation Service 写入操作
 */

import { db } from '~~/server/db'
import type { AddMessageInput, ConversationDetail, CreateConversationInput } from './types'
import { conversations, messages } from '~~/server/db/schema'
import { desc, eq } from 'drizzle-orm'

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
 * DELETE...RETURNING 一个往返完成"查是否存在 + 删除"，
 * 返回删除的 id，空数组表示对话不存在。
 *
 * 消息由数据库外键 CASCADE 自动删除，不需要手动删除。
 *
 * 返回 true 表示删除成功，false 表示对话不存在
*/
export async function deleteConversation(id: string): Promise<boolean> {
  const deleted = await db
    .delete(conversations)
    .where(eq(conversations.id, id))
    .returning({ id: conversations.id })

  return deleted.length > 0
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
  conversationId: string | undefined | null,
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
 * 并行 INSERT（消息之间互不依赖）+ 同时更新 updatedAt，
 * N+1 次 DB 往返压缩为 1 次等待。
 *
 * 注意：toolCallId 用 ?? null 而不是 ?? undefined。
 * Drizzle 中 undefined 语义是"跳过该列"而非"设为 NULL"。
*/
export async function addMessages(
  conversationId: string,
  msgs: AddMessageInput[]
): Promise<void> {
  try {
    await Promise.all([
      // 并行插入所有消息
      ...msgs.map(msg =>
        db.insert(messages).values({
          conversationId,
          role: msg.role,
          content: msg.content,
          toolCallId: msg.toolCallId ?? null,
          toolCalls: msg.toolCalls ?? null
        })
      ),
      // 同时更新时间戳
      db
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, conversationId))
    ])
  } catch (error: any) {
    console.error('[addMessages] INSERT/UPDATE failed:', {
      cause: error.cause?.message || error.cause,
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint
    })
    throw error
  }
}

/**
 * 删除对话的最后一条消息，供 regenerate 使用
 *
 * 先查出最新消息的 id，再按 id 删除。
 * 不回查 role 是否为 'assistant' —— 调用方保证只在 regenerate 场景使用。
 *
 * 如果对话没有消息（极端情况），静默成功（DELETE 0 行 ≠ 报错）。
*/

export async function deleteLastAssistantMessage(conversationId: string): Promise<void> {
  // 1. 找到最新消息
  const [lastMsg] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(1)

  // 2. 有则删除
  if (lastMsg) {
    await db.delete(messages).where(eq(messages.id, lastMsg.id))
  }
}
