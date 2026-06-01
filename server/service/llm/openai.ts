
/**
 * OpenAI Provider 实现了 LLMProvider 接口
 * 使用 openai 包与 OpenAI API 进行交互，支持流式聊天和模型列表获取，覆盖OpenAI及所有兼容 API 的国内模型
 * */

import OpenAI from 'openai';
import type { Message, ChatOptions } from '~~/shared/types/provider';
import type { LLMProvider, ModelInfo } from './types';

// OpenAI API 配置接口，包含 API 密钥和可选的基础 URL
interface OpenAIConfig {
  apiKey: string;
  baseUrl?: string; // 可选的 API 基础 URL，默认为 OpenAI 官方地址
  models?: ModelInfo[]; // 可选的模型列表，默认为预定义的 SUPPORTED_MODELS
}

// 定义支持的模型列表，包含模型 ID、名称以及是否支持视觉输入和工具调用
const SUPPORTED_MODELS: ModelInfo[] = [
  { id: 'gpt-4.1',name: 'GPT-4.1',supportsVision: true,supportsTools: true },
  { id: 'gpt-4.1-mini',name: 'GPT-4.1 Mini',supportsVision: true,supportsTools: true },
  { id: 'gpt-4.1-nano',name: 'GPT-4.1 Nano',supportsVision: true,supportsTools: true },
  { id: 'gpt-4o',name: 'GPT-4o',supportsVision: true,  supportsTools: true },
  { id: 'gpt-4o-mini',name: 'GPT-4o Mini',supportsVision: true,supportsTools: true },
  { id: 'o4-mini',name: 'o4 Mini',supportsVision: true,supportsTools: true },
]

export class OpenAIProvider implements LLMProvider {
  readonly id = 'openai';
  private client: OpenAI;
  private modelsList: ModelInfo[];

  constructor(config: OpenAIConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    })
    this.modelsList = config.models || SUPPORTED_MODELS;
  }

  async chat(messages: Message[], options: ChatOptions): Promise<ReadableStream<string>> {
    // ① 构建请求体 —— systemPrompt 转为 messages 中的 system role
    const requestMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    if (options.systemPrompt) {
      requestMessages.push({ role: 'system', content: options.systemPrompt });
    }
    // for (const msg of messages) {
    //   requestMessages.push({
    //     role: msg.role as 'user' | 'assistant' | 'system',
    //     content: msg.content
    //   });
    // }
    for (const msg of messages) {
      switch (msg.role) {
        case 'user':
        case 'assistant':
          requestMessages.push({ role: msg.role, content: msg.content })
          break
        case 'system':
          // 已通过 options.systemPrompt 处理，跳过
          break
        case 'tool':
          requestMessages.push({
            role: 'tool',
            tool_call_id: msg.toolCallId!,
            content: msg.content,
          })
          break
      }
    }

    // ② 发起请求，获取流式响应
    const stream = await this.client.chat.completions.create({
      model: options.model,
      messages: requestMessages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: true,
      // TODO: tools 支持
    })

    // ③ 将 OpenAI 的流式响应转换为 ReadableStream<string>
    return new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const delta = chunk.choices?.[0]?.delta;

            if (!delta?.content) continue; // 只处理文本内容，忽略工具调用等其他信息
            controller.enqueue(delta.content);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      }
    })
  }

  models(): ModelInfo[] {
    return this.modelsList;
  }
}


