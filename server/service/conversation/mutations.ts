/**
 * Conversation Service 写入操作
 */

import { db } from '~~/server/db'
import type { AddMessageInput, ConversationDetail, CreateConversationInput, MessageDetail } from './types'
import type { Message } from '~~/shared/types/provider'
import { conversations, messages } from '~~/server/db/schema'
import { asc, eq, inArray } from 'drizzle-orm'
import { sanitizeDbText } from '~~/server/utils/text'

/**
 * 创建新会话: 返回完整对象
 * .returning() 是 Drizzle PostgreSQL 特性，INSERT 后直接返回插入的行。
*/
export async function createConversation(input: CreateConversationInput): Promise<ConversationDetail> {
  const [row] = await db
    .insert(conversations)
    .values({
      title: input.title || '新对话',
      model: input.model
    })
    .returning()

  // row 不可能为 undefined（.returning() 保证返回值，除非 DB 连接断）
  return {
    id: row!.id,
    title: row!.title,
    model: row!.model,
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
    .returning()

  return deleted.length > 0
}

/**
 * chat 端点专用：查询或者创建对话 有 ID 则查 + 验证存在，无 ID 则创建
 *
 * 为什么合并？chat 端点里"查或建"是一个原子语义，
 * 拆成两个函数调用会让 handler 里有 if/else 分叉。
 * 合并后 handler 变成一行：
 *   const conv = await getOrCreateConversation(conversationId, { model })
*/
export async function getOrCreateConversation(
  conversationId: string | undefined | null,
  defaults: { model: string }
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
    model: defaults.model
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
  await Promise.all([
    // 并行插入所有消息
    ...msgs.map(msg =>
      db.insert(messages).values({
        conversationId,
        role: msg.role,
        content: sanitizeDbText(msg.content),
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
}

/**
 * 插入单条消息，返回插入的行。
 *
 * 注意：toolCallId 用 ?? null 而不是 ?? undefined。
 * Drizzle 中 undefined 语义是"跳过该列"而非"设为 NULL"。
*/
export async function insertMessage(
  conversationId: string,
  data: {
    role: string
    content: string
    toolCalls?: Message['toolCalls']
    toolCallId?: string
  }
): Promise<MessageDetail> {
  const [row] = await db.insert(messages).values({
    conversationId,
    role: data.role,
    content: sanitizeDbText(data.content),
    toolCallId: data.toolCallId ?? null,
    toolCalls: data.toolCalls ?? null
  }).returning()

  return {
    id: row!.id,
    conversationId: row!.conversationId,
    role: row!.role as Message['role'],
    content: row!.content,
    toolCallId: row!.toolCallId ?? undefined,
    toolCalls: row!.toolCalls as Message['toolCalls'],
    createdAt: row!.createdAt.toISOString()
  }
}

/**
 * 更新消息内容
*/
export async function updateMessage(
  messageId: string,
  data: { content: string }
): Promise<void> {
  await db
    .update(messages)
    .set({ content: sanitizeDbText(data.content) })
    .where(eq(messages.id, messageId))
}

/**
 * 删除对话最后一次 assistant 回复的整组消息，供 regenerate 使用
 *
 * Agent 一次回复在 DB 中是多行（assistant(tool_calls) → tool → assistant(text)），
 * regenerate 需要把「最后一个 user 之后的所有消息」整组删除，否则残留旧的工具消息。
 *
 * 实现：按时间正序加载全部消息，在应用层找到最后一条 user 的索引（与前端
 * regenerate 的 splice 逻辑对称），再按 id 精确删除该 user 之后的所有消息。
 *
 * 为什么不用 createdAt 做 SQL 删除边界：createdAt 是 timestamp（微秒精度），
 * 经 Drizzle 读回会转成 JS Date（毫秒精度），微秒被截断。若再把它回传进
 * `gt(createdAt, 边界)` 比较，边界会被置成 .000 微秒，比真实值小，
 * 导致最后一条 user 消息本身以及同一毫秒内的上一轮回复被误删。
 * 按 id 删除彻底规避这个精度问题。
 *
 * 如果对话没有 user 消息（极端情况），静默成功（DELETE 0 行 ≠ 报错）。
*/

export async function deleteLastAssistantGroup(conversationId: string): Promise<void> {
  // 1. 按时间正序加载全部消息（只取 id + role，避免 content 大字段），id 作 secondary 排序保证稳定
  const rows = await db
    .select({ id: messages.id, role: messages.role })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt), asc(messages.id))

  // 2. 找到最后一条 user 的索引
  let lastUserIndex = -1
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]!.role === 'user') {
      lastUserIndex = i
      break
    }
  }
  if (lastUserIndex === -1) return

  // 3. 按 id 精确删除该 user 之后的所有消息（整组 assistant/tool）
  const deleteIds = rows.slice(lastUserIndex + 1).map(r => r.id)
  if (deleteIds.length === 0) return

  await db.delete(messages).where(inArray(messages.id, deleteIds))
}

/**
 * 更新对话信息
 *
*/
/**
 * 更新对话信息
 *
 * - 只允许更新 title / model
 * - id 和 createdAt 不可变
 * - updatedAt 自动刷新
 */
export async function updateConversationById(
  id: string,
  data: { title?: string, model?: string }
): Promise<void> {
  await db
    .update(conversations)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(conversations.id, id))
}
