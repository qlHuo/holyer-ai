/**
 * 删除对话
*/
import { deleteConversation } from '~~/server/service/conversation'
import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))

  const deleted = await deleteConversation(id)
  if (!deleted) {
    throw createError({
      statusCode: 404,
      message: '对话不存在'
    })
  }

  return { success: true }
})
