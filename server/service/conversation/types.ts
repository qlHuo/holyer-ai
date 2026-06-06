/**
 * Conversation Service 层 — 内部类型
 *
 * 为什么需要这个文件？
 * shared/types/conversation.ts 是前后端共享类型（API 契约），
 * 但 Service 层内部有些参数是 API 不会直接暴露的。
 * 比如 addMessages 接受原始 Message 数组（来自 Provider 类型），
 * 返回的是 Drizzle 插入后的行类型。
 */
import type { Message } from '~~/shared/types/provider'
import type { ConversationDetail, ConversationListItem } from '~~/shared/types/conversation'

// 创建会话参数
export interface CreateConversationInput {
  title?: string
  model: string
  provider: string
}

// 添加消息的输入
export interface AddMessageInput {
  role: Message['role']
  content: string
  toolCalls?: Message['toolCalls']
  toolCallId?: string
}

export type { ConversationDetail, ConversationListItem }
