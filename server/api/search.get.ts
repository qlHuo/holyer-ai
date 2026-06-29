/**
 * 跨对话全文搜索
 *
 * GET /api/search?q=搜索词
 *
 * 返回按时间倒序排列的匹配消息列表（上限 50 条）。
 * 每条结果包含消息内容、所属对话信息，前端负责分组和高亮展示。
 */
import { z } from 'zod'
import { searchMessages } from '~~/server/service/conversation'
import { successResponse } from '~~/server/utils/response'
import type { ApiSuccess } from '~~/shared/types/response'
import type { MessageSearchResult } from '~~/server/service/conversation/queries'

const QuerySchema = z.object({
  q: z.string().min(1, '搜索词不能为空').max(200, '搜索词过长')
})

export default defineEventHandler(async (event): Promise<ApiSuccess<MessageSearchResult[]>> => {
  const parsed = QuerySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? '参数校验失败'
    })
  }

  const results = await searchMessages(parsed.data.q)
  return successResponse(results)
})
