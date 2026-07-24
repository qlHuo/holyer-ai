/**
 * @Description 获取提示词列表 - GET /api/prompts
 */
import { getPromptList } from '~~/server/service/prompts'
import type { PromptListItem } from '~~/shared/types/prompt'
import type { ApiSuccess } from '~~/shared/types/response'
import { successResponse } from '~~/server/utils/response'

export default defineEventHandler(async (): Promise<ApiSuccess<PromptListItem[]>> => {
  const data = await getPromptList()
  return successResponse(data)
})
