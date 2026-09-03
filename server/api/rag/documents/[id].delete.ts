/**
 * @Description 删除文档（级联删向量切片） - DELETE /api/rag/documents/:id
 */
import type { ApiSuccess } from '~~/shared/types/response'
import { deleteDocument } from '~~/server/service/rag/documents'
import { uuidSchema } from '~~/server/api/rag/schema'
import { successResponse } from '~~/server/utils/response'

export default defineEventHandler(async (event): Promise<ApiSuccess> => {
  const id = uuidSchema.parse(await getRouterParam(event, 'id'))

  const deleted = await deleteDocument(id)
  if (!deleted) {
    throw createError({ statusCode: 404, message: '文档不存在' })
  }

  return successResponse(true)
})
