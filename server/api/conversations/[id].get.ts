/**
 * 获取对话详情 + 历史消息
 * */
import { getConversationDetail } from '~~/server/service/conversation'
import type { ConversationDetail } from '~~/shared/types/conversation'

export default defineEventHandler(async (event): Promise<ConversationDetail> => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'id is required'
    })
  }
  // 获取对话详情
  const detail = await getConversationDetail(id)
  if (!detail) {
    throw createError({
      statusCode: 404,
      message: 'Conversation not found'
    })
  }
  return detail
})
