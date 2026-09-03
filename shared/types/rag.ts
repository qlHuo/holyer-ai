/**
 * RAG 知识库 — 前后端共享类型（API 契约）
 *
 * 与 server/db/schema.ts 的表结构区分：这里是给前端/调用方用的视图类型，
 * 时间已是 ISO string、计数已算好，不带 embedding 等内部字段。
 */

// 知识库列表项（docCount = 该库下的文档数）
export interface KnowledgeBase {
  id: string
  name: string
  description: string
  createdAt: string
  updatedAt: string
  docCount: number
}

// 建库 / 改库表单参数 — POST 与 PUT /api/rag/knowledge-bases（契约一致：name 必填）
export interface CreateKnowledgeBaseInput {
  name: string
  description?: string
}

// 文档列表项（不含原文，原文走 GET /api/rag/documents/:id 下载）
export interface DocumentSummary {
  id: string
  kbId: string
  title: string
  sourceType: string
  createdAt: string
  chunkCount: number
}

// 文档详情（含原文 content，供下载/预览）
export interface DocumentDetail extends DocumentSummary {
  content: string
}

// 上传文档参数 — POST /api/rag/documents
export interface UploadDocumentInput {
  kbId: string
  title: string
  content: string
}

// POST /api/rag/documents 返回值（UI 展示「切成 N 块」用）
export interface UploadResult {
  document: DocumentSummary
  chunkCount: number
}
