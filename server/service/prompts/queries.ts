/**
 * @Description Prompt Service 只读操作
 *
 * 每个函数返回共享 API 契约类型 （PromptListItem | PromptDetail ）
 * 不是 Drizzle 原始行类型 — 类型转换在 Service 层完成。
 */
import { db } from '~~/server/db'
import { prompts } from '~~/server/db/schema'
import type { PromptListItem, PromptDetail } from './types'
import { desc, eq } from 'drizzle-orm'

/**
 * 获取提示词列表(按更新时间倒序)
 */
export async function getPromptList(): Promise<PromptListItem[]> {
  const rows = await db.select({
    id: prompts.id,
    name: prompts.name,
    description: prompts.description,
    prompt: prompts.prompt,
    createdAt: prompts.createdAt,
    updatedAt: prompts.updatedAt

  }).from(prompts).orderBy(desc(prompts.updatedAt))

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description,
    prompt: row.prompt,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }))
}

/**
 * 获取单个提示词详情，不存在返回null
*/
export async function getPromptDetail(id: string): Promise<PromptDetail | null> {
  const [row] = await db.select({
    id: prompts.id,
    name: prompts.name,
    description: prompts.description,
    prompt: prompts.prompt,
    createdAt: prompts.createdAt,
    updatedAt: prompts.updatedAt
  }).from(prompts).where(eq(prompts.id, id))

  if (!row) return null

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    prompt: row.prompt,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}
