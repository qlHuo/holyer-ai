/**
 * ingest — 文档入库核心 service
 *
 * 把「存文档 → 语义分块 → 向量化 → 写 chunk」收进一个函数，三个入口复用：
 *   - scripts/ingest-docs.ts（本地批量灌库）
 *   - POST /api/rag/documents（运行时上传）
 *
 * 设计（与 embeddings.ts / retriever.ts 一致）：
 * - 零 Nitro 依赖，db + config 由调用方传入——
 *   脚本传自建连接 + process.env，运行时传 ~~/server/db + useRuntimeConfig
 * - 配额铁律：进 API 后 neon-http 每次 DB 查询 = 1 个 CF subrequest（50/请求），
 *   chunks 用一次多行 INSERT 写入，向量化按 BATCH_SIZE 分批，杜绝逐行 insert
 * - images 与 chunk 一起落库（补 G2：阶段 A 灌库脚本漏写 images 列）
 * - 中途失败回滚：删除已插入的 documents 行（FK 级联清掉半成品 chunks）
 */

import { eq } from 'drizzle-orm'
import type { DbClient } from '../../db'
import { documents, chunks } from '../../db/schema'
import { parseMarkdown, chunkSections } from './chunker'
import { embedTexts, EMBEDDING_MODEL } from './embeddings'
import type { EmbeddingConfig } from './embeddings'

/** 每批向量化的 chunk 数（减少 API 调用次数 + 控 subrequest） */
const BATCH_SIZE = 20

export interface IngestDocumentInput {
  kbId: string
  title: string
  /** 原始 markdown 全文 */
  content: string
  /** 来源类型，默认 'markdown'（预留格式扩展） */
  sourceType?: string
}

export interface IngestResult {
  docId: string
  chunkCount: number
}

/**
 * 单篇文档入库
 *
 * @param db      drizzle 实例（调用方传入）
 * @param config  embedding 凭据（调用方传入）
 * @param input   文档内容
 */
export async function ingestDocument(
  db: DbClient,
  config: EmbeddingConfig,
  input: IngestDocumentInput
): Promise<IngestResult> {
  const { kbId, title, content } = input

  // 1. 存文档（原文 content 支持下载；kbId FK 校验知识库存在性）
  const [doc] = await db.insert(documents).values({
    kbId,
    title,
    content,
    sourceType: input.sourceType ?? 'markdown'
  }).returning()
  const docId = doc!.id

  try {
    // 2. 语义分块，标题路径拼进 content（让 chunk 自包含、更好召回，与灌库脚本一致）
    const sections = parseMarkdown(content)
    const chunkRows = chunkSections(sections).map(c => ({
      ...c,
      content: c.headingPath.length
        ? `${c.headingPath.join(' > ')}\n${c.content}`
        : c.content
    }))

    // 3. 批量向量化（每批 BATCH_SIZE 条，一次 embedTexts = 1 次外部 HTTP）
    const vectors: number[][] = []
    for (let i = 0; i < chunkRows.length; i += BATCH_SIZE) {
      const batch = chunkRows.slice(i, i + BATCH_SIZE)
      vectors.push(...await embedTexts(batch.map(c => c.content), config))
    }

    // 4. 一次多行 INSERT 全部 chunks（含 images 元数据，不参与向量化）
    if (chunkRows.length > 0) {
      await db.insert(chunks).values(
        chunkRows.map((c, i) => ({
          docId,
          kbId,
          chunkIndex: c.chunkIndex,
          content: c.content,
          embedding: vectors[i],
          embeddingModel: EMBEDDING_MODEL,
          images: c.images
        }))
      )
    }

    return { docId, chunkCount: chunkRows.length }
  } catch (err) {
    // 5. 中途失败回滚：删 documents 行，FK 级联清掉可能已写入的 chunk
    await db.delete(documents).where(eq(documents.id, docId)).catch(() => {})
    throw err
  }
}
