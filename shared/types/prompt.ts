/**
 * 自定义提示词模板 — 前后端共享类型
 *
 * Prompt 是用户创建的自定义提示词模板（如"代码审查专家"），
 * 发起对话时选择一个注入为系统上下文。
 * 不含工具白名单或模型推荐——工具是 Agent Runtime 的职责。
 */

// 列表项 — GET /api/prompts
export interface PromptListItem {
  id: string
  name: string
  description: string
  prompt: string
  createdAt: string
  updatedAt: string
}

// 详情 — GET /api/prompts/:id
export interface PromptDetail {
  id: string
  name: string
  description: string
  prompt: string
  createdAt: string
  updatedAt: string
}

// 表单参数 — POST /api/prompts
export interface PromptInput {
  name: string
  description?: string
  prompt: string
}
