/**
 * @Description 文档详情（含原文 content，下载/预览用） - GET /api/rag/documents/:id
 */
import type { DocumentDetail } from '~~/shared/types/rag'
import type { ApiSuccess } from '~~/shared/types/response'
import { getDocument } from '~~/server/service/rag/documents'
import { uuidSchema } from '~~/server/api/rag/schema'
import { successResponse } from '~~/server/utils/response'

export default defineEventHandler(async (event): Promise<ApiSuccess<DocumentDetail>> => {
  const id = uuidSchema.parse(await getRouterParam(event, 'id'))

  const data = await getDocument(id)
  if (!data) {
    throw createError({ statusCode: 404, message: '文档不存在' })
  }

  return successResponse(data)
})
