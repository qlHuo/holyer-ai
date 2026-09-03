/**
 * Document Service — 文档 CRUD + 上传
 *
 * - 上传（createDocument）：查重 409 → 调共享的 ingestDocument 入库（分块/向量化/写库）
 * - 列表/详情带 chunkCount（两个查询 JS 合并，避免 join 类型噪音）
 * - 删文档靠 chunks 的 FK onDelete: cascade 级联清向量
 */

import { db } from '~~/server/db'
import { knowledgeBases, documents, chunks } from '~~/server/db/schema'
import { and, desc, eq, count } from 'drizzle-orm'
import type { DocumentSummary, DocumentDetail, UploadResult, UploadDocumentInput } from '~~/shared/types/rag'
import { ingestDocument } from './ingest'

/** 文档行 → 摘要（chunkCount 由外部 count Map 注入） */
function toSummary(
  row: { id: string, kbId: string, title: string, sourceType: string, createdAt: Date },
  counts: Map<string, number>
): DocumentSummary {
  return {
    id: row.id,
    kbId: row.kbId,
    title: row.title,
    sourceType: row.sourceType,
    createdAt: row.createdAt.toISOString(),
    chunkCount: counts.get(row.id) ?? 0
  }
}

/** 指定库的文档列表（不含原文，按创建倒序） */
export async function listDocuments(kbId: string): Promise<DocumentSummary[]> {
  const rows = await db.select({
    id: documents.id,
    kbId: documents.kbId,
    title: documents.title,
    sourceType: documents.sourceType,
    createdAt: documents.createdAt
  }).from(documents).where(eq(documents.kbId, kbId)).orderBy(desc(documents.createdAt))

  const cntRows = await db.select({
    docId: chunks.docId,
    n: count()
  }).from(chunks).where(eq(chunks.kbId, kbId)).groupBy(chunks.docId)

  const counts = new Map(cntRows.map(r => [r.docId, Number(r.n)]))
  return rows.map(row => toSummary(row, counts))
}

/** 文档详情（含原文 content，下载用）。不存在返回 null */
export async function getDocument(id: string): Promise<DocumentDetail | null> {
  const [row] = await db.select({
    id: documents.id,
    kbId: documents.kbId,
    title: documents.title,
    sourceType: documents.sourceType,
    content: documents.content,
    createdAt: documents.createdAt
  }).from(documents).where(eq(documents.id, id))

  if (!row) return null

  const [cnt] = await db.select({ n: count() }).from(chunks).where(eq(chunks.docId, id))
  return {
    id: row.id,
    kbId: row.kbId,
    title: row.title,
    sourceType: row.sourceType,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    chunkCount: cnt ? Number(cnt.n) : 0
  }
}

/** 删文档（FK 级联删向量）。返回是否存在 */
export async function deleteDocument(id: string): Promise<boolean> {
  const deleted = await db.delete(documents).where(eq(documents.id, id)).returning()
  return deleted.length > 0
}

/**
 * 上传文档：查重 → 入库 → 返回摘要
 * - 知识库不存在 → 404
 * - 同库同名文档已存在 → 409（向量是内容复制品，重复入库只增开销不改召回）
 */
export async function createDocument(input: UploadDocumentInput): Promise<UploadResult> {
  const kb = await db.select({ id: knowledgeBases.id }).from(knowledgeBases)
    .where(eq(knowledgeBases.id, input.kbId)).limit(1)
  if (kb.length === 0) {
    throw createError({ statusCode: 404, message: '知识库不存在' })
  }

  const dup = await db.select({ id: documents.id }).from(documents)
    .where(and(eq(documents.kbId, input.kbId), eq(documents.title, input.title))).limit(1)
  if (dup.length > 0) {
    throw createError({ statusCode: 409, message: '同名文档已存在，请修改标题或删除旧文档后重试' })
  }

  // embedding 凭据与 search 工具同源（runtimeConfig 的 NUXT_EMBEDDING_*）
  const config = useRuntimeConfig()
  const { docId, chunkCount } = await ingestDocument(db, {
    embeddingApiKey: config.embeddingApiKey,
    embeddingBaseUrl: config.embeddingBaseUrl
  }, input)

  const detail = await getDocument(docId)
  return {
    document: detail ?? {
      id: docId,
      kbId: input.kbId,
      title: input.title,
      sourceType: 'markdown',
      createdAt: new Date().toISOString(),
      chunkCount
    },
    chunkCount
  }
}
