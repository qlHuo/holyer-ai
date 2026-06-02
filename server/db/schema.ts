import { pgTable, uuid, varchar, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core'

// 对话会话
export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: varchar('title', { length: 255 }).notNull().default('新对话'),
  model: varchar('model', { length: 100 }).notNull(),
  provider: varchar('provider', { length: 50 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

// 对话消息
export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id')
    .references(() => conversations.id, { onDelete: 'cascade' })
    .notNull(),
  role: varchar('role', { length: 20 }).notNull(), // 'user' | 'assistant' | 'system'
  content: text('content').notNull(),
  toolCalls: jsonb('tool_calls'), // Agent 工具调用的原始 JSON
  createdAt: timestamp('created_at').defaultNow().notNull()
}, table => ({
  conversationIdx: index('idx_messages_conversation_id').on(table.conversationId),
  createdAtIdx: index('idx_messages_created_at').on(table.createdAt)
}))
