/**
 * SSE 事件类型枚举
 *
 * 所有事件（除 PING）都携带 conversationId 用于前端按对话路由：
 * - META:  { type: 'meta', conversationId, title }
 * - TEXT:  { type: 'text', content, conversationId }
 * - DONE:  { type: 'done', conversationId }
 * - ERROR: { type: 'error', content, conversationId }
 */
export const SSE_EVENT = {
  META: 'meta',
  TEXT: 'text',
  ROUND_START: 'round_start',
  TOOL_START: 'tool_start',
  TOOL_END: 'tool_end',
  DONE: 'done',
  ERROR: 'error',
  PING: 'ping'
} as const

// 从 const 对象提取类型
export type SSEEventType = typeof SSE_EVENT[keyof typeof SSE_EVENT]
