import { z } from 'zod'

// 创建接口校验
export const createPromptSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100, '名称不能超过 100 个字符'),
  description: z.string().max(500, '描述最长500字符').optional(),
  prompt: z.string().min(1, '提示词内容不能为空')
})

// 更新接口校验
export const updatePromptSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100, '名称不能超过 100 个字符'),
  description: z.string().max(500, '描述最长500字符').optional(),
  prompt: z.string().min(1, '提示词内容不能为空')
})

// id 校验
export const promptIdSchema = z.string().uuid().min(1, 'id 不能为空')

export type CreatePromptInput = z.infer<typeof createPromptSchema>
export type UpdatePromptInput = z.infer<typeof updatePromptSchema>
export type PromptIdInput = z.infer<typeof promptIdSchema>
