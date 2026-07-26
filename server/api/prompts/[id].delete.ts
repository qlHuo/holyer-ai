import type { ApiSuccess } from '~~/shared/types/response'
import { promptIdSchema } from './schema'
import { deletePrompt } from '~~/server/service/prompts/mutations'
import { successResponse } from '~~/server/utils/response'

/**
 * @Description 删除提示词 - DELETE /api/prompts/:id
 */
export default defineEventHandler(async (event): Promise<ApiSuccess> => {
  const id = promptIdSchema.parse(await getRouterParam(event, 'id'))

  const deleted = await deletePrompt(id)
  if (!deleted) {
    throw createError({
      statusCode: 404,
      message: '提示词不存在'
    })
  }

  return successResponse(true)
})
