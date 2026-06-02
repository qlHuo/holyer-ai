import type { ChatOptions, Message } from '~~/shared/types/provider'

/**
 * LLMProvider 接口定义了一个通用的语言模型提供者，支持多种 LLM 实现（如 OpenAI、Azure、Anthropic 等）
 * 设计原则：
 * 1. chat() 返回 ReadableStream<string> —— 纯文本 token 流
 *    上层不关心底层是 OpenAI SSE 还是 Anthropic SSE
 * 2. models() 返回模型列表 —— UI 自动获取，无需硬编码
 * 3. id 是唯一标识 —— factory 用它做路由
*/
export interface LLMProvider {
  readonly id: string
  /**
   * 发起流式聊天请求，返回一个 ReadableStream<string>，上层通过读取这个流来获取生成的文本 token
   * @param messages - 消息列表，包含用户输入和系统提示词
   * @param options - 聊天选项，包含模型名称、温度、最大 token 数、可用工具和系统提示词
   * @returns ReadableStream<string> - 生成文本的流式输出
  */
  chat(messages: Message[], options: ChatOptions): Promise<ReadableStream<string>>

  /**
   * 返回 provider 支持的模型列表
   * @returns ModelInfo[] - 模型信息列表
   */
  models(): ModelInfo[]
}

export interface ModelInfo {
  id: string
  name: string
  supportsVision?: boolean
  supportsTools?: boolean
}
