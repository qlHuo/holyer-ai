/**
 * retriever — 纯向量检索
 *
 * 拿「查询向量」和 chunks.embedding 算余弦相似度，取 top-k 最相关片段。
 * - 纯向量：MVP 只做向量召回，混合检索（+ tsvector）是阶段 C
 * - 零 Nitro 依赖：db 由调用方传入——灌库脚本自己建连接、运行时工具传 ~~/server/db
 * - 向量用 pgvector 的 <=>（余弦距离）运算符，需原始 SQL（Drizzle 无类型化距离 API）
 */

import { sql } from 'drizzle-orm'
import type { DbClient } from '../../db'
import type { ChunkImage } from '../../db/schema'

/** 检索结果（带来源标注 + 附图元数据，供引用溯源与图片白名单） */
export interface SearchResult {
  chunkId: string
  documentId: string
  documentTitle: string
  chunkIndex: number
  content: string
  /** 该 chunk 的图片元数据（决策 7：不参与向量化，随文带出供渲染） */
  images: ChunkImage[]
  score: number // 余弦相似度 0~1，越高越相关
}

export interface SearchOptions {
  kbId?: string // 可选，按知识库过滤
  topK?: number // 默认 5
}

/** 原始 SQL 返回的行（snake_case，与 SELECT 列对齐） */
interface RawRow {
  id: string
  doc_id: string
  kb_id: string
  chunk_index: number
  content: string
  document_title: string
  images: string | null // jsonb 经 ::text 取出，规避双驱动 jsonb 返回形状差异
  score: number | string
}

/** 解析 images 文本：非法/空 → [] */
function parseImages(text: string | null | undefined): ChunkImage[] {
  if (!text) return []
  try {
    const arr = JSON.parse(text) as unknown
    if (Array.isArray(arr)) {
      return arr.filter((x): x is ChunkImage =>
        x !== null && typeof x === 'object'
        && typeof (x as ChunkImage).url === 'string'
        && typeof (x as ChunkImage).alt === 'string'
      )
    }
  } catch {
    // 非法 JSON → 视为无图
  }
  return []
}

/**
 * 纯向量检索：queryVec → top-k 相关片段
 * @param db      drizzle 实例（调用方传入）
 * @param queryVec 查询向量（调用方先用 embedText 算好）
 */
export async function searchChunks(
  db: DbClient,
  queryVec: number[],
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const topK = options.topK ?? 5
  // pgvector 的向量字面量格式：[0.1,0.2,...]
  const vecStr = `[${queryVec.join(',')}]`
  // 可选的知识库过滤（为空时查全库）
  const kbFilter = options.kbId ? sql`WHERE c.kb_id = ${options.kbId}` : sql``

  const result = await db.execute(sql`
    SELECT
      c.id,
      c.doc_id,
      c.kb_id,
      c.chunk_index,
      c.content,
      c.images::text AS images,
      d.title AS document_title,
      1 - (c.embedding <=> ${vecStr}::vector) AS score
    FROM chunks c
    JOIN documents d ON d.id = c.doc_id
    ${kbFilter}
    ORDER BY c.embedding <=> ${vecStr}::vector
    LIMIT ${topK}
  `)

  // 双驱动返回形状不同：postgres-js 直接返回行数组，neon-http 返回 { rows }
  // 只有直接写sql语句查询时才会有这个问题。统一走drizzle的 类型化查询构造器，drizzle内部处理了
  const rows = ('rows' in result ? result.rows : result) as unknown as RawRow[]
  return rows.map(row => ({
    chunkId: row.id,
    documentId: row.doc_id,
    documentTitle: row.document_title,
    chunkIndex: row.chunk_index,
    content: row.content,
    images: parseImages(row.images),
    score: Number(row.score)
  }))
}
