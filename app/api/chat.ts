/**
 * Chat SSE 端点
 *
 * 不用 $fetch（它会等整个响应读完再 JSON.parse，破坏流式）
 * 用原生 fetch，返回 Response 对象供 useChat composable 逐块读取
 */
import type { Message } from '~~/shared/types/provider'

export interface ChatRequest {
  provider: string
  model: string
  message: Message[]
  conversationId: string | null
  tools?: object[]
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
}

export default {
  /**
   * 发送聊天消息，返回 SSE 流 Response
   *
   * @param params  请求体
   * @param signal  AbortController.signal（用于中断生成）
   */
  sendChatMessage(params: ChatRequest, signal?: AbortSignal) {
    return fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal
    })
  }
}
