/**
 *  对话持久化 — 前后端共享类型
 */
import type { Message } from './provider'

// 对话列表项 【GET】api/conversations
export interface ConversationListItem {
  id: string
  title: string
  model: string
  provider: string
  messageCount: number
  // 最后一条消息的预览数据截取50字
  lastPreview: string | null
  createdAt: string
  updatedAt: string
}

// 对话详情 【GET】api/conversations/:id
export interface ConversationDetail {
  id: string
  title: string
  model: string
  provider: string
  messages: Message[]
  createdAt: string
  updatedAt: string
}

// 对话创建 【POST】 api/conversations
export interface ConversationInput {
  title?: string
  model: string
  provider: string
}

// Messgae 详情
export interface MessageDetail {
  id: string
  conversationId: string
  role: Message['role']
  content: string
  toolCalls?: Message['toolCalls']
  toolCallId?: string
  createdAt: string
}
