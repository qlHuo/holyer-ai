import request from './request'
import type { PromptListItem, PromptDetail, PromptInput } from '~~/shared/types/prompt'

export default {
  /**
   * @Description 获取提示词列表 GEWT /api/prompts
   * @returns {Promise<PromptListItem[]>}
  */
  getPromptList() {
    return request<PromptListItem[]>(`/api/prompts`)
  },

  /**
   * @Description 创建提示词 POST /api/prompts
   * @param {PromptInput} data
   * @returns {Promise<PromptDetail>}
  */
  createPrompt(data: PromptInput) {
    return request<PromptDetail>(`/api/prompts`, {
      method: 'POST',
      body: data
    })
  },

  /**
   * @Description 获取提示词详情 GET /api/prompts/:id
   * @param {string} id
   * @returns {Promise<PromptDetail | null>}
  */
  getPromptDetail(id: string) {
    return request<PromptDetail | null>(`/api/prompts/${id}`)
  },

  /**
   * @Description 更新提示词 PUT /api/prompts/:id
   * @param {string} id
   * @param {PromptInput} data
   * @returns {Promise<PromptDetail>}
  */
  updatePrompt(id: string, data: PromptInput) {
    return request<PromptDetail>(`/api/prompts/${id}`, {
      method: 'PUT',
      body: data
    })
  },

  /**
   * @Description 删除提示词 DELETE /api/prompts/:id
   * @param {string} id
   * @returns {Promise<boolean>}
  */
  deletePrompt(id: string) {
    return request<boolean>(`/api/prompts/${id}`, {
      method: 'DELETE'
    })
  }
}
