/**
 * 删除对话
 *
 * 消息不需要手动删 —— schema 里 onDelete: 'cascade' 保证了删对话时消息自动清掉。这就是"先 delete 父行，子行自动跟删"。
 * 先查存在再删，区分"404 不存在"和"200 删除成功"。
 * 返回 { success: true } 而不是 204 No Content —— 前端通常需要知道操作结果。
*/
import { eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { conversations } from '~~/server/db/schema'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'id is required'
    })
  }

  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, id))

  if (!conversation) {
    throw createError({
      statusCode: 404,
      message: 'conversation not found'
    })
  }

  // 删除对话
  await db.delete(conversations).where(eq(conversations.id, id))
  return { success: true }
})
