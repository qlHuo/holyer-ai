/**
 * 新建对话
*/
import { createConversation } from '~~/server/service/conversation/mutations'
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
  return createConversation({ title, model, provider })
})
