/**
 * 新建对话
 *
 * 这个端点不是主流程。主流程是前端直接调 /api/chat，chat 内部自动创建对话。这个端点留给"用户点'新建对话'按钮但还没发消息"的场景。
 * .returning() 是 Drizzle 的 PostgreSQL 特性，INSERT 后直接返回插入的行，省一次 SELECT。
 * 返回 ConversationDetail（含空 messages 数组），前端可以直接用这个结构。
*/
import { db } from '~~/server/db'
import { conversations } from '~~/server/db/schema'
import type { ConversationDetail } from '~~/shared/types/conversation'

export default defineEventHandler(async (event): Promise<ConversationDetail> => {
  const body = await readBody(event)
  const { title, model, provider } = body
  if (!model || !provider) {
    throw createError({
      statusCode: 400,
      message: 'model or provider is required'
    })
  }

  const [row] = await db
    .insert(conversations)
    .values({
      title: title || '新对话',
      model,
      provider
    }).returning()

  return {
    id: row?.id as string,
    title: row?.title as string,
    model: row?.model as string,
    provider: row?.provider as string,
    messages: [],
    createdAt: row?.createdAt.toISOString() as string,
    updatedAt: row?.updatedAt.toISOString() as string
  }
})
