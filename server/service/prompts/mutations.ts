/**
 * @Description prompt service 写入操作
 */
import { db } from '~~/server/db'
import { prompts } from '~~/server/db/schema'
import { eq } from 'drizzle-orm'
import type { PromptDetail, PromptInput } from './types'

/**
 * @Description 创建提示词
 * .returning() 是Drizzle PostgreSQL 特性，INSERT 后直接返回插入的行
 */
export async function createPrompt(data: PromptInput): Promise<PromptDetail> {
  const [row] = await db
    .insert(prompts)
    .values({
      name: data.name,
      description: data.description,
      prompt: data.prompt
    })
    .returning()

  return {
    id: row!.id,
    name: row!.name,
    description: row!.description,
    prompt: row!.prompt,
    createdAt: row!.createdAt.toISOString(),
    updatedAt: row!.updatedAt.toISOString()
  }
}

/**
 * @Description 更新提示词
 */
export async function updatePrompt(id: string, data: PromptInput): Promise<PromptDetail | null> {
  const [row] = await db
    .update(prompts)
    .set({
      name: data.name,
      description: data.description,
      prompt: data.prompt,
      updatedAt: new Date()
    })
    .where(eq(prompts.id, id))
    .returning()

  if (!row) return null

  return {
    id: row!.id,
    name: row!.name,
    description: row!.description,
    prompt: row!.prompt,
    createdAt: row!.createdAt.toISOString(),
    updatedAt: row!.updatedAt.toISOString()
  }
}

/**
 * @Description 删除提示词
 * 返回 true 表示删除成功，否则删除失败
 */
export async function deletePrompt(id: string): Promise<boolean> {
  const deleted = await db
    .delete(prompts)
    .where(eq(prompts.id, id))
    .returning()

  return deleted.length > 0
}
