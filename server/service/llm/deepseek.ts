// ============================================================
// DeepSeek Provider
// 纯 fetch 实现，不依赖任何 SDK —— 练习手动 SSE 解析
// ============================================================

import type { Message, ChatOptions } from '~~/shared/types/provider'
import type { LLMProvider, ModelInfo } from './types'

interface DeepSeekConfig {
  apiKey: string
  baseUrl?: string
  models?: ModelInfo[] // 可选的模型列表，默认为预定义的 SUPPORTED_MODELS
}

const SUPPORTED_MODELS: ModelInfo[] = [
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', supportsVision: false, supportsTools: false },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', supportsVision: false, supportsTools: false }
]

export class DeepSeekProvider implements LLMProvider {
  readonly id = 'deepseek'
  private apiKey: string
  private baseUrl: string
  private modelsList: ModelInfo[]

  constructor(config: DeepSeekConfig) {
    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl || 'https://api.deepseek.com'
    this.modelsList = config.models || SUPPORTED_MODELS
  }

  async chat(messages: Message[], options: ChatOptions): Promise<ReadableStream<string>> {
    // 1. 提取并合并 system prompt
    const systemFromMessages = messages
      .filter(m => m.role === 'system')
      .map(m => m.content)
      .join('\n\n')

    const systemPrompt = [options.systemPrompt, systemFromMessages]
      .filter(Boolean)
      .join('\n\n') || undefined

    const requestMessages: Array<{ role: string, content: string }> = []

    if (systemPrompt) {
      requestMessages.push({ role: 'system', content: systemPrompt })
    }

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
            // tool_call_id: msg.toolCallId!,
            content: msg.content
          })
          break
      }
    }
    const body: {
      model: string
      messages: Array<{ role: string, content: string }>
      stream: boolean
      temperature?: number
      max_tokens?: number
    } = {
      model: options.model,
      messages: requestMessages,
      stream: true
    }

    if (options.temperature !== undefined) {
      body.temperature = options.temperature
    }

    if (options.maxTokens !== undefined) {
      body.max_tokens = options.maxTokens
    }

    // 2. 发起请求，获取流式响应
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`DeepSeek API error: ${response.status} ${response.statusText} - ${errorText}`)
    }

    return this.parseSSEStream(response)
  }

  /**
   * 将 fetch 返回的 ReadableStream<Uint8Array> 解析为纯文本 token 流
   *
   * SSE 格式回顾：
   *   data: {"choices":[{"delta":{"content":"你"}}]}
   *   data: {"choices":[{"delta":{"content":"好"}}]}
   *   data: [DONE]
   *
   * 每条消息以 \n\n 结束，单行以 "data: " 开头。
   */
  private parseSSEStream(response: Response): ReadableStream<string> {
    const reader = response.body!.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    // ReadableStream 的 start() 是方法简写而非箭头函数，this 指向上层对象而非类实例，必须预先捕获
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const _this = this
    return new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done) {
              // 处理最后残留的 buffer
              if (buffer.trim()) {
                const token = _this.parseLine(buffer)
                if (token) controller.enqueue(token)
              }
              break
            }

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop()! // 最后一行可能不完整，保留在 buffer 中

            for (const line of lines) {
              const token = _this.parseLine(line)
              if (token) controller.enqueue(token)
            }
          }
          controller.close()
        } catch (error) {
          controller.error(error)
        }
      }
    })
  }

  /**
   * 解析一行 SSE 数据
   * @returns token 字符串，如果不是内容行则返回 null
   */
  private parseLine(line: string): string | null {
    // 跳过空行和非 data 行
    if (!line.startsWith('data: ')) return null

    // 去掉 "data: " 前缀
    const jsonStr = line.slice(6).trim()

    if (jsonStr === '[DONE]') return null // 流结束标志

    try {
      const parsed = JSON.parse(jsonStr)
      const content = parsed.choices?.[0]?.delta?.content
      return content || null // 只返回文本内容，忽略其他信息
    } catch (_error) {
      return null // 解析错误，忽略该行
    }
  }

  models(): ModelInfo[] {
    return this.modelsList
  }
}
