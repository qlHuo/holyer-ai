/**
 * @Description 修改知识库（名称/描述，全量更新） - PUT /api/rag/knowledge-bases/:id
 */
import type { KnowledgeBase } from '~~/shared/types/rag'
import type { ApiSuccess } from '~~/shared/types/response'
import { updateKnowledgeBase } from '~~/server/service/rag/knowledge-bases'
import { updateKnowledgeBaseSchema, uuidSchema } from '~~/server/api/rag/schema'
import { successResponse } from '~~/server/utils/response'

export default defineEventHandler(async (event): Promise<ApiSuccess<KnowledgeBase>> => {
  const id = uuidSchema.parse(await getRouterParam(event, 'id'))
  const body = updateKnowledgeBaseSchema.parse(await readBody(event))

  const data = await updateKnowledgeBase(id, body)
  if (!data) {
    throw createError({ statusCode: 404, message: '知识库不存在' })
  }

  return successResponse(data)
})
