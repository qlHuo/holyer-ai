// 创建LLM Provider 实例
// 后续接入：
// 1. 修改 env 配置中的 NUXT_MODEL_BASE_URL NUXT_MODEL_API_KEY 即可
// 2. 修改 MODEL 配置

import type { LLMProvider } from './types'
import { OpenAIProvider } from './openai'
import { MODELS } from '~~/app/constants/models'


export function createLLMProvider(): LLMProvider {
  const config = useRuntimeConfig()
  if (!config.modelApiKey || !config.modelBaseUrl) {
    throw new Error('modelApiKey 或 modelBaseUrl 未配置。请在 .env 中设置 NUXT_MODEL_API_KEY NUXT_MODEL_BASE_URL')
  }
  return new OpenAIProvider({
    apiKey: config.modelApiKey,
    baseUrl: config.modelBaseUrl,
    models: MODELS || []
  })
}
