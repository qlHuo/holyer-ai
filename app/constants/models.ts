import type { ModelInfo } from '~~/server/service/llm/types'

// 模型列表
export const MODELS: ModelInfo[] = [
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', supportsVision: true, supportsTools: true },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', supportsVision: true, supportsTools: true }
]
