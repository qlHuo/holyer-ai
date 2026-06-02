// ============================================================
// Provider 工厂
// 按 provider ID 返回对应实例 —— 一行配置接入新模型
// ============================================================

import type { LLMProvider, ModelInfo } from './types'
import { OpenAIProvider } from './openai'
import { AnthropicProvider } from './anthropic'
import { DeepSeekProvider } from './deepseek'

/**
 * 根据 provider ID 创建对应的 LLM Provider 实例
 *
 * 使用方式：
 *   const provider = createLLMProvider('openai')
 *   const stream = await provider.chat(messages, options)
 *
 * 新增 Provider 只需：
 *   1. 实现 LLMProvider 接口
 *   2. 在下面的 switch 中加一个 case
 *   3. 在 process.env 中配 API Key
 */
export function createLLMProvider(providerId: string, models?: ModelInfo[]): LLMProvider {
  const config = useRuntimeConfig()

  switch (providerId) {
    case 'openai':
      if (!config.openaiApiKey) {
        throw new Error('OpenAI API Key 未配置。请在 .env 中设置 NUXT_OPENAI_API_KEY')
      }
      return new OpenAIProvider({
        apiKey: config.openaiApiKey,
        baseUrl: config.openaiBaseUrl,
        models
      })

    case 'anthropic':
      if (!config.anthropicApiKey) {
        throw new Error('Anthropic API Key 未配置。请在 .env 中设置 NUXT_ANTHROPIC_API_KEY')
      }
      return new AnthropicProvider({
        apiKey: config.anthropicApiKey,
        baseUrl: config.anthropicBaseUrl,
        models
      })

    case 'deepseek':
      if (!config.deepseekApiKey) {
        throw new Error('DeepSeek API Key 未配置。请在 .env 中设置 NUXT_DEEPSEEK_API_KEY')
      }
      return new DeepSeekProvider({
        apiKey: config.deepseekApiKey,
        baseUrl: config.deepseekBaseUrl,
        models
      })

    default:
      throw new Error(`Unsupported provider: ${providerId}`)
  }
}
