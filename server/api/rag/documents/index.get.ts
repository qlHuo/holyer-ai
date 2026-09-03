/**
 * @Description 文档列表 - GET /api/rag/documents?kbId=xxx
 */
import type { DocumentSummary } from '~~/shared/types/rag'
import type { ApiSuccess } from '~~/shared/types/response'
import { listDocuments } from '~~/server/service/rag/documents'
import { uuidSchema } from '~~/server/api/rag/schema'
import { successResponse } from '~~/server/utils/response'

export default defineEventHandler(async (event): Promise<ApiSuccess<DocumentSummary[]>> => {
  const query = getQuery(event)
  const kbId = uuidSchema.parse(query.kbId)
  const data = await listDocuments(kbId)
  return successResponse(data)
})
