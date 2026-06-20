// 事件类型枚举（供前端 switch 后端 enqueue 使用）
export const SSE_EVENT = {
  META: 'meta',
  TEXT: 'text',
  DONE: 'done',
  ERROR: 'error',
  PING: 'ping'
} as const

// 从 const 对象提取类型
export type SSEEventType = typeof SSE_EVENT[keyof typeof SSE_EVENT]
