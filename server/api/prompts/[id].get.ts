/**
 * @Description 获取提示词详情 - GET /api/prompts/:id
 */
import type { PromptDetail } from '~~/shared/types/prompt'
import { getPromptDetail } from '~~/server/service/prompts/queries'
import { successResponse } from '~~/server/utils/response'
import type { ApiSuccess } from '~~/shared/types/response'
import { promptIdSchema } from './schema'

export default defineEventHandler(async (event): Promise<ApiSuccess<PromptDetail>> => {
  const id = promptIdSchema.parse(await getRouterParam(event, 'id'))

  const detail = await getPromptDetail(id)
  if (!detail) {
    throw createError({
      statusCode: 404,
      message: '提示词不存在'
    })
  }

  return successResponse(detail)
})
