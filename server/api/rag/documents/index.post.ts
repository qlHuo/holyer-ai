/**
 * @Description 上传文档（markdown 纯文本） - POST /api/rag/documents
 *
 * 与灌库脚本复用同一套 ingest service。同名文档重复上传返回 409。
 */
import type { UploadResult } from '~~/shared/types/rag'
import type { ApiSuccess } from '~~/shared/types/response'
import { createDocument } from '~~/server/service/rag/documents'
import { createDocumentSchema } from '~~/server/api/rag/schema'
import { successResponse } from '~~/server/utils/response'

export default defineEventHandler(async (event): Promise<ApiSuccess<UploadResult>> => {
  const body = createDocumentSchema.parse(await readBody(event))
  const data = await createDocument(body)
  return successResponse(data)
})
