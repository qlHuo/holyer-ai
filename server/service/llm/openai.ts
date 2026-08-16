/**
 * OpenAI Provider 实现了 LLMProvider 接口
 * 使用 openai 包与 OpenAI API 进行交互，支持流式聊天和模型列表获取，覆盖OpenAI及所有兼容 API 的国内模型
 * */

import OpenAI from 'openai'
import type { Message, ChatOptions, LLMStreamChunk } from '~~/shared/types/provider'
import type { LLMProvider, ModelInfo } from './types'
import { extractSystemPrompt } from '~~/server/utils/system-prompt'

// OpenAI API 配置接口，包含 API 密钥和可选的基础 URL
interface OpenAIConfig {
  apiKey: string
  baseUrl?: string // 可选的 API 基础 URL，默认为 OpenAI 官方地址
  models?: ModelInfo[] // 可选的模型列表
}

export class OpenAIProvider implements LLMProvider {
  readonly id = 'openai'
  private client: OpenAI
  private modelsList: ModelInfo[]

  constructor(config: OpenAIConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl
    })
    this.modelsList = config.models || []
  }

  async chat(messages: Message[], options: ChatOptions): Promise<ReadableStream<LLMStreamChunk>> {
    // ① 提取并合并 system prompt
    const systemPrompt = extractSystemPrompt(messages, options.systemPrompt)

    // ② 构建请求体
    const requestMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []

    if (systemPrompt) {
      requestMessages.push({ role: 'system', content: systemPrompt })
    }

    for (const msg of messages) {
      switch (msg.role) {
        case 'user':
          requestMessages.push({ role: msg.role, content: msg.content })
          break
        case 'assistant':
          if (msg.toolCalls?.length) {
            requestMessages.push({
              role: 'assistant',
              content: msg.content || null,
              tool_calls: msg.toolCalls.map(tc => ({
                id: tc.id,
                type: 'function' as const,
                function: {
                  name: tc.name,
                  arguments: tc.arguments
                }
              }))
            })
          } else {
            requestMessages.push({ role: msg.role, content: msg.content })
          }
          break
        case 'system':
          // 已通过 options.systemPrompt 处理，跳过
          break
        case 'tool':
          requestMessages.push({
            role: 'tool',
            tool_call_id: msg.toolCallId!,
            content: msg.content
          })
          break
      }
    }

    // ② 发起请求，获取流式响应
    // signal 必须放在第二个参数（RequestOptions）里，放在 body 里会类型报错
    const stream = await this.client.chat.completions.create(
      {
        model: options.model,
        messages: requestMessages,
        stream: true,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        ...(options.tools?.length
          ? {
              tools: options.tools.map(t => ({
                type: 'function' as const,
                function: { name: t.name, description: t.description, parameters: t.parameters }
              }))
            }
          : {})
      },
      { signal: options.signal }
    )

    // ③ 将 OpenAI 的流式响应转换为 ReadableStream<string>
    return new ReadableStream<LLMStreamChunk>({
      async start(controller) {
        try {
          // Map<index, { id, name, arguments }> 按 index 聚拢分片到达的 tool call delta
          const toolCallAccumulator = new Map<number, { id: string, name: string, arguments: string }>()

          for await (const chunk of stream) {
            const delta = chunk.choices?.[0]?.delta
            if (delta?.content) {
              controller.enqueue({ type: 'text', content: delta.content })
            }

            // 工具调用 delta → 累积（不即时发出，arguments 是不完整 JSON 片段）
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const existing = toolCallAccumulator.get(tc.index) ?? { id: '', name: '', arguments: '' }
                if (tc.id) existing.id = tc.id
                if (tc.function?.name) existing.name += tc.function.name
                if (tc.function?.arguments) existing.arguments += tc.function.arguments
                toolCallAccumulator.set(tc.index, existing)
              }
            }
          }

          // 累积的 tool call delta 转为完整 ToolCall 列表
          if (toolCallAccumulator.size) {
            const toolCalls = Array.from(toolCallAccumulator.values()).map(tc => ({
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments
            }))
            controller.enqueue({ type: 'tool_calls', toolCalls })
          }
          controller.enqueue({ type: 'done' })
          controller.close()
        } catch (error) {
          controller.error(error)
        }
      }
    })
  }

  models(): ModelInfo[] {
    return this.modelsList
  }
}
