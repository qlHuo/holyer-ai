import type { PromptDetail } from '~~/shared/types/prompt'
import type { ApiSuccess } from '~~/shared/types/response'
import { createPrompt } from '~~/server/service/prompts'
import { createPromptSchema } from '~~/server/api/prompts/schema'
import { successResponse } from '~~/server/utils/response'

/**
 * @Description 创建提示词 - POST /api/prompts
 */
export default defineEventHandler(async (event): Promise<ApiSuccess<PromptDetail>> => {
  const body = createPromptSchema.parse(await readBody(event))
  const data = await createPrompt(body)
  return successResponse(data)
})
