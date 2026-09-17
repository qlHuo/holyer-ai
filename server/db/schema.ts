import { pgTable, uuid, varchar, text, jsonb, timestamp, integer, index, vector, customType } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// 对话会话
export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: varchar('title', { length: 255 }).notNull().default('新对话'),
  model: varchar('model', { length: 100 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

// 对话消息
export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id')
    .references(() => conversations.id, { onDelete: 'cascade' })
    .notNull(),
  role: varchar('role', { length: 20 }).notNull(), // 'user' | 'assistant' | 'system' | 'tool'
  content: text('content').notNull(),
  toolCalls: jsonb('tool_calls'), // Agent 工具调用的原始 JSON
  toolCallId: varchar('tool_call_id', { length: 100 }),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, table => ({
  conversationIdx: index('idx_messages_conversation_id').on(table.conversationId),
  createdAtIdx: index('idx_messages_created_at').on(table.createdAt)
}))

// 自定义提示词模板
export const prompts = pgTable('prompts', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description').notNull().default(''),
  prompt: text('prompt').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

// ─────────────────────────────────────────────
// RAG 知识库：knowledge_bases → documents → chunks
// ─────────────────────────────────────────────

// 切片图片元数据（URL 进元数据列，不进向量，见 RAG 设计决策 7）
export type ChunkImage = { url: string, alt: string }

// drizzle-orm 无 tsvector 类型，用 customType 兜底（仅用于迁移 DDL 生成；运行时查询走 raw SQL）
const tsvector = customType<{ data: string, driverData: string }>({
  dataType() { return 'tsvector' }
})

// 知识库
export const knowledgeBases = pgTable('knowledge_bases', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description').notNull().default(''),
  userId: uuid('user_id'), // 预留：多用户隔离，加 auth 时启用
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

// 文档（所属知识库，原文 content 存 DB 支持下载）
export const documents = pgTable('documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  kbId: uuid('kb_id').references(() => knowledgeBases.id, { onDelete: 'cascade' }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  sourceType: varchar('source_type', { length: 50 }).notNull().default('markdown'), // 来源通道：local 灌库 / github 引入 / manual 手动（'markdown' 为历史灌库遗留默认）
  content: text('content').notNull(), // 原始 markdown
  // 引用溯源（3.11）：GitHub 引入时写 github.com/{owner}/{repo}/blob/{branch}/{path}，供 citation chip 回链原文。
  // local/manual 来源为 NULL（历史 GitHub 文档导入时未记录 owner/repo，同样为 NULL）
  sourceUrl: text('source_url'),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, table => ({
  kbIdx: index('idx_documents_kb_id').on(table.kbId)
}))

// 切片（切片文本 + 向量 + 元数据）
export const chunks = pgTable('chunks', {
  id: uuid('id').defaultRandom().primaryKey(),
  docId: uuid('doc_id').references(() => documents.id, { onDelete: 'cascade' }).notNull(),
  kbId: uuid('kb_id').references(() => knowledgeBases.id, { onDelete: 'cascade' }).notNull(),
  chunkIndex: integer('chunk_index').notNull(), // 块序号：保证原文顺序 + 引用溯源
  content: text('content').notNull(), // 切片文本（参与向量化）
  embedding: vector('embedding', { dimensions: 1024 }), // 1024 维向量（pgvector）
  embeddingModel: varchar('embedding_model', { length: 100 }), // 预留：模型切换时识别旧模型
  contextualText: text('contextual_text'), // 阶段 C：Contextual Retrieval 预生成上下文
  images: jsonb('images').$type<ChunkImage[]>(), // 图片元数据（不参与向量化）
  // 引用溯源（3.11）：结构化标题路径（H1→当前节的祖先链，chunker 的 headingPath 原样落库）。
  // 用 jsonb 而非 text[]：与 images 同一条已验证的读写路径（写入走 drizzle jsonb、读取经 ::text 后 JSON.parse），
  // 规避 postgres-js / neon-http 双驱动对数组类型的返回形状差异。存量数据由 scripts/backfill-heading-path.ts 回填
  headingPath: jsonb('heading_path').$type<string[]>(),
  // 全文检索：分词结果（空格分隔），由 tokenizer.toIndexedText 写入。可空无 default —— NULL 是回填游标
  contentTokens: text('content_tokens'),
  // 全文检索：生成列，自动从 content_tokens 派生（IMMUTABLE 表达式，满足生成列要求）
  // ⚠️ 表达式用裸文本 'content_tokens'：若重命名该列，必须同步改这里（drizzle-kit 不会替你改）
  contentTsv: tsvector('content_tsv').generatedAlwaysAs(sql`to_tsvector('simple', content_tokens)`)
}, table => ({
  docIdx: index('idx_chunks_doc_id').on(table.docId),
  kbIdx: index('idx_chunks_kb_id').on(table.kbId),
  tsvIdx: index('idx_chunks_content_tsv').using('gin', table.contentTsv)
}))
