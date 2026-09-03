import { z } from 'zod'

// 建库 — POST /api/rag/knowledge-bases
export const createKnowledgeBaseSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100, '名称不能超过 100 个字符'),
  description: z.string().max(500, '描述最长500字符').optional()
})

// 修改知识库 — PUT /api/rag/knowledge-bases/:id
// 与建库契约一致（name 必填、description 选填，缺省清空），全量覆盖更新
export const updateKnowledgeBaseSchema = createKnowledgeBaseSchema

// 上传文档 — POST /api/rag/documents
export const createDocumentSchema = z.object({
  kbId: z.string().uuid('kbId 需为 UUID'),
  title: z.string().min(1, '标题不能为空').max(255, '标题不能超过 255 个字符'),
  content: z.string().min(1, '内容不能为空').max(500_000, '内容过长（超过 500KB）')
})

// UUID 路径/查询参数
export const uuidSchema = z.string().uuid('id 需为 UUID')

export type CreateKnowledgeBaseInput = z.infer<typeof createKnowledgeBaseSchema>
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>
