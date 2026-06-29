import request from './request'
import type { MessageSearchResult } from '~~/server/service/conversation/queries'

export default {
  /**
   * 跨对话全文搜索
   * GET /api/search?q=搜索词
   */
  search(q: string) {
    return request<MessageSearchResult[]>('/api/search', {
      query: { q }
    })
  }
}
