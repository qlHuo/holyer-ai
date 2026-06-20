import { z } from 'zod'

export const CreateConversationSchema = z.object({
  title: z.string().max(100).optional(),
  model: z.string().min(1, 'model 是必填项'),
  provider: z.enum(['openai', 'anthropic', 'deepseek'])
})

export type CreateConversationBody = z.infer<typeof CreateConversationSchema>
