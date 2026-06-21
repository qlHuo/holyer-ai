import request from './request'
import type { ConversationDetail, ConversationListItem } from '~~/shared/types/conversation'

export default {
  /**
   *  获取对话列表
   *  后端: GET /api/conversations → { success: true, data: ConversationListItem[] }
  */
  getList() {
    return request<ConversationListItem[]>('/api/conversations')
  },

  /**
   * 获取对话详情 + 历史消息
   * 后端: GET /api/conversations/{id} → { success: true, data: ConversationDetail }
   */
  getDetailById(id: string) {
    return request<ConversationDetail>(`/api/conversations/${id}`)
  },

  /**
   * 创建新对话
   * 后端: POST /api/conversations → { success: true, data: ConversationDetail }
   */
  create(params: { title?: string, model: string, provider: string }) {
    return request<ConversationDetail>('/api/conversations', {
      method: 'POST',
      body: params
    })
  },

  /**
   * 删除对话
   * 后端: DELETE /api/conversations/{id} → { success: true }（无 data）
   */
  deleteById(id: string) {
    return request(`/api/conversations/${id}`, {
      method: 'DELETE'
    })
  }
}
