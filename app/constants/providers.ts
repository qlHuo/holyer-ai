import type { ModelInfo } from '~~/server/service/llm/types'

export interface ProviderInfo {
  id: string
  name: string
  models: ModelInfo[]
}

// 模型选择器的数据源
export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', supportsVision: false, supportsTools: false },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', supportsVision: false, supportsTools: false }
    ]
  },
  {
    id: 'openai',
    name: 'OpenAI',
    models: [
      { id: 'gpt-4.1', name: 'GPT-4.1', supportsVision: true, supportsTools: true },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', supportsVision: true, supportsTools: true }
    ]
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: [
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', supportsVision: true, supportsTools: true },
      { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', supportsVision: true, supportsTools: true },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', supportsTools: true }
    ]
  }

]
