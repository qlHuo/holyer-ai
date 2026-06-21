/**
 * 获取所有对话列表
*/
import type { ConversationListItem } from '~~/server/service/conversation/types'
import { getConversationList } from '~~/server/service/conversation'
import { successResponse } from '~~/server/utils/response'
import type { ApiSuccess } from '~~/shared/types/response'

export default defineEventHandler(async (): Promise<ApiSuccess<ConversationListItem[]>> => {
  const data = await getConversationList()
  return successResponse(data)
})
