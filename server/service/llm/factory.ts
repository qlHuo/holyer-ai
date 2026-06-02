// ============================================================
// Provider 工厂
// 按 provider ID 返回对应实例 —— 一行配置接入新模型
// ============================================================

import type { LLMProvider } from './types'
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
export function createLLMProvider(providerId: string): LLMProvider {
  const config = useRuntimeConfig()

  switch (providerId) {
    case 'openai':
      if (!config.openaiApiKey) {
        throw new Error('OpenAI API Key 未配置。请在 .env 中设置 NUXT_OPENAI_API_KEY')
      }
      return new OpenAIProvider({
        apiKey: config.openaiApiKey,
        baseUrl: config.openaiBaseUrl // 可选，默认为官方地址
      })

    case 'anthropic':
      if (!config.anthropicApiKey) {
        throw new Error('Anthropic API Key 未配置。请在 .env 中设置 NUXT_ANTHROPIC_API_KEY')
      }
      return new AnthropicProvider({
        apiKey: config.anthropicApiKey
      })

    case 'deepseek':
      if (!config.deepseekApiKey) {
        throw new Error('DeepSeek API Key 未配置。请在 .env 中设置 NUXT_DEEPSEEK_API_KEY')
      }
      return new DeepSeekProvider({
        apiKey: config.deepseekApiKey,
        baseUrl: config.deepseekBaseUrl // 可选，默认为官方地址
      })

    default:
      throw new Error(`Unsupported provider: ${providerId}`)
  }
}
