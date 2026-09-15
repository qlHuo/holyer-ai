/**
 * retriever — 混合检索（向量 + 全文 + RRF 融合）
 *
 * 两路召回，互补后融合：
 * - searchByVector：pgvector 余弦距离 top-K —— 语义相似，但对精确术语/代码标识符召回弱
 * - searchByKeyword：PostgreSQL tsvector 全文 —— 词面精确命中，但不懂同义词
 * - hybridSearch：两路各取候选 top-N（默认 20）→ RRF 融合 → top-K（默认 5）
 *
 * 原理见 docs/learning-notes/hybrid-retrieval.md，方案见 docs/dev-log/2026-09-14-rag-stage-c-plan.md。
 *
 * 零 Nitro 依赖：db 由调用方传入——灌库脚本自己建连接、运行时工具传 ~~/server/db。
 * 向量用 pgvector 的 <=>（余弦距离）运算符，全文用 ts_rank_cd，均需原始 SQL（Drizzle 无类型化 API）。
 */

import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { DbClient } from '../../db'
import type { ChunkImage } from '../../db/schema'
import { toQueryText } from './tokenizer'

/** 命中来源：向量路 / 全文路 / 两路都命中 */
export type SearchSource = 'vector' | 'keyword' | 'both'

/** 检索结果（带来源标注 + 附图元数据，供引用溯源与图片白名单） */
export interface SearchResult {
  chunkId: string
  documentId: string
  documentTitle: string
  chunkIndex: number
  content: string
  /** 该 chunk 的图片元数据（决策 7：不参与向量化，随文带出供渲染） */
  images: ChunkImage[]
  /** 融合相关度分：hybrid 下为 RRF 分；searchByVector 下为余弦相似度 0~1 */
  score: number
  /** 命中来源 */
  source: SearchSource
  /** 余弦相似度 0~1（仅向量路命中的 chunk 有） */
  similarity?: number
  /** 向量路名次（1 起；未命中该路为 undefined） */
  vectorRank?: number
  /** 全文路名次（1 起；未命中该路为 undefined） */
  keywordRank?: number
}

export interface SearchOptions {
  /** 可选，按单个知识库过滤（兼容旧调用方） */
  kbId?: string
  /** 可选，按多个知识库过滤（自定义范围；kbId 与 kbIds 互斥时优先 kbIds） */
  kbIds?: string[]
  /** 融合后返回条数，默认 5 */
  topK?: number
  /** 每路候选池大小，默认 20（仅混合检索用） */
  candidates?: number
  /** RRF 平滑常数，默认 60 */
  k?: number
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

/** 知识库过滤条件：优先 kbIds[]（多库），其次 kbId（单库）；都为空 → 全库（TRUE） */
function buildKbCondition(options: SearchOptions): SQL {
  const kbIds = options.kbIds?.length ? options.kbIds : (options.kbId ? [options.kbId] : [])
  return kbIds.length
    ? sql`c.kb_id IN (${sql.join(kbIds, sql`, `)})`
    : sql`TRUE`
}

/**
 * 双驱动结果归一化 + 行映射。
 * 返回形状不同：postgres-js 直接返回行数组，neon-http 返回 { rows }（只有直接写 sql 查询时才有此差异）。
 */
function mapRows(result: unknown, source: SearchSource): SearchResult[] {
  const maybe = result as { rows?: unknown }
  const rows = (Array.isArray(maybe.rows) ? maybe.rows : result) as unknown as RawRow[]
  return rows.map((row) => {
    const score = Number(row.score)
    return {
      chunkId: row.id,
      documentId: row.doc_id,
      documentTitle: row.document_title,
      chunkIndex: row.chunk_index,
      content: row.content,
      images: parseImages(row.images),
      score,
      source,
      ...(source === 'vector' ? { similarity: score } : {})
    }
  })
}

/**
 * 向量检索：queryVec → top-k 余弦相似片段。
 * @param db       drizzle 实例（调用方传入）
 * @param queryVec 查询向量（调用方先用 embedText 算好）
 */
export async function searchByVector(
  db: DbClient,
  queryVec: number[],
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const topK = options.topK ?? 5
  // pgvector 的向量字面量格式：[0.1,0.2,...]
  const vecStr = `[${queryVec.join(',')}]`
  const kbCondition = buildKbCondition(options)

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
    WHERE ${kbCondition}
    ORDER BY c.embedding <=> ${vecStr}::vector
    LIMIT ${topK}
  `)

  return mapRows(result, 'vector')
}

/**
 * 全文检索：query → tsvector 词面命中，ts_rank_cd 排序。
 *
 * tsquery 构造用 `plainto_tsquery`（把入参当纯文本，不解析运算符 → 任何 token 都不会造成语法错或注入），
 * 再把其输出的 ` & ` 换成 ` | ` 得到 OR 语义（提高召回，靠 ts_rank_cd 按命中词数排序）。
 * 直接用 to_tsquery 手工拼 token 会因标识符里的 `:` `-` `/` 报语法错。
 */
export async function searchByKeyword(
  db: DbClient,
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const candidates = options.candidates ?? options.topK ?? 20
  const queryText = toQueryText(query)
  // 空查询（全为停用词/标点）短路：避免空 tsquery 的边界
  if (!queryText) return []

  const kbCondition = buildKbCondition(options)

  const result = await db.execute(sql`
    WITH q AS (
      SELECT replace(plainto_tsquery('simple', ${queryText})::text, ' & ', ' | ')::tsquery AS query
    )
    SELECT
      c.id,
      c.doc_id,
      c.kb_id,
      c.chunk_index,
      c.content,
      c.images::text AS images,
      d.title AS document_title,
      ts_rank_cd(c.content_tsv, q.query) AS score
    FROM chunks c
    JOIN documents d ON d.id = c.doc_id
    CROSS JOIN q
    WHERE c.content_tsv @@ q.query AND ${kbCondition}
    ORDER BY score DESC, c.id
    LIMIT ${candidates}
  `)

  return mapRows(result, 'keyword')
}

/**
 * RRF 融合（Reciprocal Rank Fusion）：score = Σ 1/(k + rank_i)，未出现在某路则该路贡献 0。
 * 只用名次、不用分数 —— 两路分数（余弦相似度 vs ts_rank_cd）量纲不可比。
 */
export function fuseRRF(
  vectorHits: SearchResult[],
  keywordHits: SearchResult[],
  topK: number,
  k = 60
): SearchResult[] {
  interface Entry { hit: SearchResult, v: number | null, kw: number | null }
  const map = new Map<string, Entry>()
  const put = (hit: SearchResult, which: 'v' | 'kw', rank: number) => {
    let entry = map.get(hit.chunkId)
    if (!entry) {
      entry = { hit, v: null, kw: null }
      map.set(hit.chunkId, entry)
    }
    if (which === 'v') entry.v = rank
    else entry.kw = rank
  }
  vectorHits.forEach((h, i) => put(h, 'v', i + 1))
  keywordHits.forEach((h, i) => put(h, 'kw', i + 1))

  return [...map.values()]
    .map(entry => ({
      entry,
      rrf: (entry.v !== null ? 1 / (k + entry.v) : 0) + (entry.kw !== null ? 1 / (k + entry.kw) : 0)
    }))
    .sort((a, b) =>
      // 必须确定性 tiebreak：单路 rank-1 恒为同一分数，否则结果顺序不稳（破坏评测可复现性与 prompt 缓存）
      b.rrf - a.rrf
      || (a.entry.v ?? Infinity) - (b.entry.v ?? Infinity) // 平分时向量名次优先（语义更可靠）
      || (a.entry.kw ?? Infinity) - (b.entry.kw ?? Infinity)
      || (a.entry.hit.chunkId < b.entry.hit.chunkId ? -1 : 1)
    )
    .slice(0, topK)
    .map(({ entry, rrf }) => ({
      ...entry.hit,
      score: rrf,
      source: (entry.v !== null && entry.kw !== null ? 'both' : entry.v !== null ? 'vector' : 'keyword') as SearchSource,
      vectorRank: entry.v ?? undefined,
      keywordRank: entry.kw ?? undefined
    }))
}

/**
 * 混合检索：两路并行召回 → RRF 融合。
 *
 * 全文路失败时降级为纯向量（catch → []）—— 全文是增强项，它挂了不该把向量结果也一起丢掉。
 */
export async function hybridSearch(
  db: DbClient,
  queryVec: number[],
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const candidates = options.candidates ?? 20
  const topK = options.topK ?? 5
  const k = options.k ?? 60

  const [vectorHits, keywordHits] = await Promise.all([
    searchByVector(db, queryVec, { ...options, topK: candidates }),
    searchByKeyword(db, query, { ...options, topK: candidates }).catch((err) => {
      console.warn('[retriever] 全文检索失败，降级为纯向量：', err)
      return [] as SearchResult[]
    })
  ])

  return fuseRRF(vectorHits, keywordHits, topK, k)
}

/** @deprecated 用 searchByVector；保留别名以兼容既有调用方 */
export const searchChunks = searchByVector
