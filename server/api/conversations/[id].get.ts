/**
 * 获取对话详情 + 历史消息
 * */
import { getConversationDetail } from '~~/server/service/conversation'
import type { ConversationDetail } from '~~/shared/types/conversation'
import { z } from 'zod'

export default defineEventHandler(async (event): Promise<ConversationDetail> => {
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))

  // 获取对话详情
  const detail = await getConversationDetail(id)
  if (!detail) {
    throw createError({
      statusCode: 404,
      message: '对话不存在'
    })
  }
  return detail
})
