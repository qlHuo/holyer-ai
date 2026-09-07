import request from './request'
import type {
  KnowledgeBase,
  CreateKnowledgeBaseInput,
  DocumentSummary,
  DocumentDetail,
  UploadDocumentInput,
  UploadResult
} from '~~/shared/types/rag'

export default {
  /**
   * @Description 获取知识库列表 GET /api/rag/knowledge-bases
   * @returns {Promise<KnowledgeBase[]>}
  */
  getKnowledgeBases() {
    return request<KnowledgeBase[]>(`/api/rag/knowledge-bases`)
  },

  /**
   * @Description 创建知识库 POST /api/rag/knowledge-bases
   * @param {CreateKnowledgeBaseInput} data
   * @returns {Promise<KnowledgeBase>}
  */
  createKnowledgeBase(data: CreateKnowledgeBaseInput) {
    return request<KnowledgeBase>(`/api/rag/knowledge-bases`, {
      method: 'POST',
      body: data
    })
  },

  /**
   * @Description 更新知识库 PUT /api/rag/knowledge-bases/:id（全量覆盖 name+description）
   * @param {string} id
   * @param {CreateKnowledgeBaseInput} data
   * @returns {Promise<KnowledgeBase>}
  */
  updateKnowledgeBase(id: string, data: CreateKnowledgeBaseInput) {
    return request<KnowledgeBase>(`/api/rag/knowledge-bases/${id}`, {
      method: 'PUT',
      body: data
    })
  },

  /**
   * @Description 删除知识库 DELETE /api/rag/knowledge-bases/:id（级联删文档+向量）
   * @param {string} id
   * @returns {Promise<boolean>}
  */
  deleteKnowledgeBase(id: string) {
    return request<boolean>(`/api/rag/knowledge-bases/${id}`, {
      method: 'DELETE'
    })
  },

  /**
   * @Description 获取某库文档列表 GET /api/rag/documents?kbId=
   * @param {string} kbId
   * @returns {Promise<DocumentSummary[]>}
  */
  getDocuments(kbId: string) {
    return request<DocumentSummary[]>(`/api/rag/documents`, {
      query: { kbId }
    })
  },

  /**
   * @Description 上传文档 POST /api/rag/documents（纯文本 markdown，同名同库返回 409）
   * @param {UploadDocumentInput} data
   * @returns {Promise<UploadResult>}
  */
  uploadDocument(data: UploadDocumentInput) {
    return request<UploadResult>(`/api/rag/documents`, {
      method: 'POST',
      body: data
    })
  },

  /**
   * @Description 获取文档详情 GET /api/rag/documents/:id（含原文 content）
   * @param {string} id
   * @returns {Promise<DocumentDetail>}
  */
  getDocumentDetail(id: string) {
    return request<DocumentDetail>(`/api/rag/documents/${id}`)
  },

  /**
   * @Description 删除文档 DELETE /api/rag/documents/:id（级联删向量切片）
   * @param {string} id
   * @returns {Promise<boolean>}
  */
  deleteDocument(id: string) {
    return request<boolean>(`/api/rag/documents/${id}`, {
      method: 'DELETE'
    })
  }
}
