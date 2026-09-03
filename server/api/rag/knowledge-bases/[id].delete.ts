/**
 * @Description 删除知识库（级联删文档+向量） - DELETE /api/rag/knowledge-bases/:id
 */
import type { ApiSuccess } from '~~/shared/types/response'
import { deleteKnowledgeBase } from '~~/server/service/rag/knowledge-bases'
import { uuidSchema } from '~~/server/api/rag/schema'
import { successResponse } from '~~/server/utils/response'

export default defineEventHandler(async (event): Promise<ApiSuccess> => {
  const id = uuidSchema.parse(await getRouterParam(event, 'id'))

  const deleted = await deleteKnowledgeBase(id)
  if (!deleted) {
    throw createError({ statusCode: 404, message: '知识库不存在' })
  }

  return successResponse(true)
})
