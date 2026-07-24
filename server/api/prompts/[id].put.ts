/**
 * @Description 更新提示词 - PUT /api/prompts/:id
 */

import type { PromptDetail } from '~~/shared/types/prompt'
import type { ApiSuccess } from '~~/shared/types/response'
import { promptIdSchema, updatePromptSchema } from './schema'
import { updatePrompt } from '~~/server/service/prompts'

export default defineEventHandler(async (event): Promise<ApiSuccess<PromptDetail>> => {
  const id = promptIdSchema.parse(await getRouterParam(event, 'id'))
  const body = updatePromptSchema.parse(await readBody(event))

  const data = await updatePrompt(id, body)
  if (!data) {
    throw createError({
      statusCode: 404,
      message: '提示词不存在'
    })
  }

  return successResponse(data)
})
