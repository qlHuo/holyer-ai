/**
 * 删除对话
*/
import { deleteConversation } from '~~/server/service/conversation'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'id is required'
    })
  }

  const deleted = await deleteConversation(id)
  if (!deleted) {
    throw createError({
      statusCode: 404,
      message: 'conversation not found'
    })
  }

  return { success: true }
})
