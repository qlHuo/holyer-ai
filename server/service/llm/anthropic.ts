// ============================================================
// Anthropic Provider
// 使用 @anthropic-ai/sdk，覆盖 Claude 全系
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import type { Message, ChatOptions } from '~~/shared/types/provider';
import type { LLMProvider, ModelInfo } from './types';

interface AnthropicConfig {
  apiKey: string;
  models?: ModelInfo[]; // 可选的模型列表，默认为预定义的 SUPPORTED_MODELS
}

const SUPPORTED_MODELS: ModelInfo[] = [
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', supportsVision: true, supportsTools: true },
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', supportsVision: true, supportsTools: true },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', supportsTools: true },
]

export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic';
  private client: Anthropic;
  private modelList: ModelInfo[];

  constructor(config: AnthropicConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
    })
    this.modelList = config.models || SUPPORTED_MODELS;
  }

  async chat(messages: Message[], options: ChatOptions): Promise<ReadableStream<string>> {
    // 1. 构建 messages —— Anthropic 不接受 system/tool role，需要过滤和转换
    const anthropicMessages: Array<{ role: 'user' | 'assistant'; content: string }> = []

    for (const msg of messages) {
      switch (msg.role) {
        case 'user':
        case 'assistant':
          anthropicMessages.push({ role: msg.role, content: msg.content })
          break
        case 'tool':
          // Anthropic 的 tool_result 必须包在 user 消息里
          anthropicMessages.push({
            role: 'user',
            content: JSON.stringify({
              type: 'tool_result',
              tool_use_id: msg.toolCallId,
              content: msg.content,
            }),
          })
          break
        case 'system':
          // 已在下方 systemFromMessages 中提取，跳过
          break
      }
    }

    // 2. 从 messages 中提取 system prompt（如果调用方通过 messages 传入）
    const systemFromMessages = messages
      .filter(msg => msg.role === 'system')
      .map(msg => msg.content)
      .join('\n\n')

    const effectiveSystemPrompt = options.systemPrompt || systemFromMessages || undefined

    const params: Anthropic.MessageCreateParams = {
      model: options.model,
      max_tokens: options.maxTokens ?? 4096,
      messages: anthropicMessages,
      stream: true,
    }

    if (effectiveSystemPrompt) {
      params.system = effectiveSystemPrompt
    }

    if (options.temperature !== undefined) {
      params.temperature = options.temperature
    }

    // 3. 发起流式请求
    const stream = await this.client.messages.create(params)

    return new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              controller.enqueue(event.delta.text);
            }
            // 忽略其他事件类型（如工具调用、结束事件等），上层不关心
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      }
    })
  }

  models(): ModelInfo[] {
    return this.modelList;
  }
}

