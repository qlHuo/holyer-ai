/**
 * @Description 获取知识库列表 - GET /api/rag/knowledge-bases
 */
import { getKnowledgeBaseList } from '~~/server/service/rag/knowledge-bases'
import type { KnowledgeBase } from '~~/shared/types/rag'
import type { ApiSuccess } from '~~/shared/types/response'
import { successResponse } from '~~/server/utils/response'

export default defineEventHandler(async (): Promise<ApiSuccess<KnowledgeBase[]>> => {
  const data = await getKnowledgeBaseList()
  return successResponse(data)
})
