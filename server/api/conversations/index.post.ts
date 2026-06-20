/**
 * 新建对话
*/
import { createConversation } from '~~/server/service/conversation'
import type { ConversationDetail } from '~~/shared/types/conversation'
import { CreateConversationSchema } from './schema'

export default defineEventHandler(async (event): Promise<ConversationDetail> => {
  const body = CreateConversationSchema.parse(await readBody(event))
  const { title, model, provider } = body
  return createConversation({ title, model, provider })
})
