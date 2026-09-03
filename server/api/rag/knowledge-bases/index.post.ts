/**
 * @Description 创建知识库 - POST /api/rag/knowledge-bases
 */
import type { KnowledgeBase } from '~~/shared/types/rag'
import type { ApiSuccess } from '~~/shared/types/response'
import { createKnowledgeBase } from '~~/server/service/rag/knowledge-bases'
import { createKnowledgeBaseSchema } from '~~/server/api/rag/schema'
import { successResponse } from '~~/server/utils/response'

export default defineEventHandler(async (event): Promise<ApiSuccess<KnowledgeBase>> => {
  const body = createKnowledgeBaseSchema.parse(await readBody(event))
  const data = await createKnowledgeBase(body)
  return successResponse(data)
})
