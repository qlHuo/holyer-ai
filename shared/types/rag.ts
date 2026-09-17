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

// 文档来源通道（原"格式位"改造——需求只做 markdown，格式轴已死，改为记录来源）：
// local=本地灌库脚本 / github=GitHub 引入 / manual=手动上传（未来手动新建）。
// DB 中历史 'markdown' 行在读取边界统一归一化为 local。
export type DocumentSourceType = 'local' | 'github' | 'manual'

// 文档列表项（不含原文，原文走 GET /api/rag/documents/:id 下载）
export interface DocumentSummary {
  id: string
  kbId: string
  title: string
  sourceType: DocumentSourceType
  /** 原文链接：仅 GitHub 引入的文档有（github.com/{owner}/{repo}/blob/{branch}/{path}），其余为 null */
  sourceUrl: string | null
  createdAt: string
  chunkCount: number
}

// 文档详情（含原文 content，供下载/预览）
export interface DocumentDetail extends DocumentSummary {
  content: string
  /**
   * 该文档所有 chunk 的图片 URL 并集（3.11 预览用）。
   * 预览渲染整篇文档时需要一份「哪些图允许出图」的白名单——按文档来源限定，与检索侧
   * allowedImages「按本轮检索结果限定」是同一条原则。
   */
  imageUrls: string[]
}

// 上传文档参数 — POST /api/rag/documents
export interface UploadDocumentInput {
  kbId: string
  title: string
  content: string
  /** 来源通道，缺省服务端落 'manual' */
  sourceType?: DocumentSourceType
  /** 原文链接（仅 GitHub 引入传，供引用溯源回链）；缺省服务端落 NULL */
  sourceUrl?: string
  /** true=同名覆盖（先成功入库新文档再删旧）；缺省/undefined=保持 409 */
  overwrite?: boolean
}

// POST /api/rag/documents 返回值（UI 展示「切成 N 块」用）
export interface UploadResult {
  document: DocumentSummary
  chunkCount: number
}

// ==================== 聊天知识库引用范围（Chat kbConfig 契约） ====================

/** 聊天知识库引用模式：auto=LLM 自主检索全部（默认）；off=不引用；custom=限定到指定库 */
export const KB_REFERENCE_MODES = ['auto', 'off', 'custom'] as const
export type KbReferenceMode = typeof KB_REFERENCE_MODES[number]

/** 聊天请求体 kbConfig —— FE store / ChatRequest、服务端 ChatBodySchema 的单一契约源 */
export interface ChatKbConfig {
  mode: KbReferenceMode
  /** custom 模式下用户指定的知识库 id 列表（空/未传 = 无约束，等同 auto 全库） */
  kbIds?: string[]
}
