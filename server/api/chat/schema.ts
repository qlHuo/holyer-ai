import { z } from 'zod'

const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  toolCalls: z.array(z.object({
    id: z.string(),
    name: z.string(),
    arguments: z.string()
  })).optional(),
  toolCallId: z.string().optional()
})

// 聊天请求体
export const ChatBodySchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'deepseek']),
  model: z.string().min(1, 'model 不能为空'),
  message: z.array(MessageSchema).min(1, '至少需要一个消息'),
  conversationId: z.string().uuid().nullish(),
  tools: z.array(z.object({
    name: z.string(),
    description: z.string(),
    parameters: z.record(z.string(), z.unknown())
  })).optional(),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional()
})

// 从 Schema 推导 TypeScript 类型（无需手动写 interface）
export type ChatBody = z.infer<typeof ChatBodySchema>
