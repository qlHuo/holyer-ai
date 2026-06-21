/**
 * 新建对话
*/
import { createConversation } from '~~/server/service/conversation'
import type { ConversationDetail } from '~~/shared/types/conversation'
import { CreateConversationSchema } from './schema'
import type { ApiSuccess } from '~~/shared/types/response'
import { successResponse } from '~~/server/utils/response'

export default defineEventHandler(async (event): Promise<ApiSuccess<ConversationDetail>> => {
  const body = CreateConversationSchema.parse(await readBody(event))
  const { title, model, provider } = body
  const data = await createConversation({ title, model, provider })
  return successResponse(data)
})
