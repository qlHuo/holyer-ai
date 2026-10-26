import { z } from 'zod'

/** 请求头映射：名称 + 值都限长，防止超大请求体 */
const headerMapSchema = z.record(
  z.string().min(1, '请求头名称不能为空').max(100, '请求头名称过长'),
  z.string().max(2000, '请求头值过长')
)

/** tools/list 快照 — 由探测结果回传保存 */
const toolSnapshotSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(20_000).optional(),
  inputSchema: z.record(z.string(), z.unknown()),
  annotations: z.record(z.string(), z.unknown()).optional()
})

const snapshotSchema = z.object({
  protocolVersion: z.string().max(20).optional(),
  serverInfo: z.object({
    name: z.string().max(200).optional(),
    version: z.string().max(100).optional()
  }).optional(),
  tools: z.array(toolSnapshotSchema).max(1000)
})

/** 只做格式与协议校验；内网地址拦截在路由层用 assertSafeHttpUrl 完成 */
const urlSchema = z.string()
  .trim()
  .min(1, '地址不能为空')
  .max(2000, '地址过长')
  .refine((value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  }, '仅支持 http:// 或 https:// 地址')

const nameSchema = z.string().trim().min(1, '名称不能为空').max(100, '名称不能超过 100 个字符')

const slugSchema = z.string()
  .trim()
  .min(1, 'slug 不能为空')
  .max(20, 'slug 不能超过 20 个字符')
  .regex(/^[a-z0-9][a-z0-9_-]*$/i, 'slug 只能包含字母、数字、下划线和连字符，且以字母或数字开头')

export const createMcpServerSchema = z.object({
  name: nameSchema,
  slug: slugSchema,
  url: urlSchema,
  headers: headerMapSchema.optional().default({}),
  enabled: z.boolean().optional().default(false),
  snapshot: snapshotSchema.optional()
})

export const updateMcpServerSchema = z.object({
  name: nameSchema,
  url: urlSchema,
  headers: headerMapSchema.optional().default({}),
  enabled: z.boolean(),
  disabledTools: z.array(z.string().max(200)).max(1000).optional(),
  snapshot: snapshotSchema.optional()
})

export const patchMcpServerSchema = z.object({
  enabled: z.boolean().optional(),
  disabledTools: z.array(z.string().max(200)).max(1000).optional()
}).refine(
  value => value.enabled !== undefined || value.disabledTools !== undefined,
  { message: '没有需要修改的字段' }
)

export const probeMcpServerSchema = z.object({
  url: urlSchema,
  headers: headerMapSchema.optional(),
  serverId: z.string().uuid('serverId 需为 UUID').optional()
})

export const mcpServerIdSchema = z.string().uuid('id 需为 UUID')

export type CreateMcpServerBody = z.infer<typeof createMcpServerSchema>
export type UpdateMcpServerBody = z.infer<typeof updateMcpServerSchema>
export type PatchMcpServerBody = z.infer<typeof patchMcpServerSchema>
export type ProbeMcpServerBody = z.infer<typeof probeMcpServerSchema>
