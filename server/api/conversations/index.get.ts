/**
 * 获取所有对话列表
*/
import type { ConversationListItem } from '~~/server/service/conversation/types'
import { getConversationList } from '~~/server/service/conversation'

export default defineEventHandler(async (): Promise<ConversationListItem[]> => {
  return await getConversationList()
})
