/**
 * Knowledge Base Service — 只读 + 写入
 *
 * 运行时 API 专用（script 不走这里），按 prompts service 风格直连 db。
 * 删库靠 documents/chunks 的 FK onDelete: cascade 级联清理，单条 SQL。
 */

import { db } from '~~/server/db'
import { knowledgeBases, documents } from '~~/server/db/schema'
import { desc, eq, count } from 'drizzle-orm'
import type { KnowledgeBase, CreateKnowledgeBaseInput } from '~~/shared/types/rag'

/** 行 → 契约对象（docCount 由外部 count Map 注入） */
function toKnowledgeBase(
  row: { id: string, name: string, description: string, createdAt: Date, updatedAt: Date },
  docCount: number
): KnowledgeBase {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    docCount
  }
}

/**
 * 知识库列表（按更新时间倒序，带 docCount）
 * 两个查询后 JS 合并：避免 leftJoin+groupBy 的嵌套形状与类型噪音
 */
export async function getKnowledgeBaseList(): Promise<KnowledgeBase[]> {
  const kbRows = await db.select({
    id: knowledgeBases.id,
    name: knowledgeBases.name,
    description: knowledgeBases.description,
    createdAt: knowledgeBases.createdAt,
    updatedAt: knowledgeBases.updatedAt
  }).from(knowledgeBases).orderBy(desc(knowledgeBases.updatedAt))

  const docRows = await db.select({
    kbId: documents.kbId,
    n: count()
  }).from(documents).groupBy(documents.kbId)

  const docCounts = new Map(docRows.map(r => [r.kbId, Number(r.n)]))
  return kbRows.map(row => toKnowledgeBase(row, docCounts.get(row.id) ?? 0))
}

/** 建库（createdAt = updatedAt = 当前时间） */
export async function createKnowledgeBase(input: CreateKnowledgeBaseInput): Promise<KnowledgeBase> {
  const [row] = await db.insert(knowledgeBases).values({
    name: input.name,
    description: input.description ?? ''
  }).returning()

  return toKnowledgeBase(row!, 0)
}

/**
 * 修改知识库（名称 / 描述，全量覆盖），刷新 updatedAt。不存在返回 null
 */
export async function updateKnowledgeBase(
  id: string,
  input: CreateKnowledgeBaseInput
): Promise<KnowledgeBase | null> {
  const [row] = await db.update(knowledgeBases)
    .set({
      name: input.name,
      description: input.description ?? '',
      updatedAt: new Date()
    })
    .where(eq(knowledgeBases.id, id))
    .returning()

  if (!row) return null
  return toKnowledgeBase(row, 0)
}

/** 删库（FK 级联删 documents + chunks）。返回是否存在 */
export async function deleteKnowledgeBase(id: string): Promise<boolean> {
  const deleted = await db.delete(knowledgeBases).where(eq(knowledgeBases.id, id)).returning()
  return deleted.length > 0
}
