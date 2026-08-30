# RAG Schema — 三表结构与 Drizzle 建表语法

> 一句话：RAG 的数据模型是三层外键「知识库 → 文档 → 切片」，向量（`embedding`）和文本（`content`）住在同一张表的同一行。pgvector **不是**独立向量库，只是给 PostgreSQL 加了个 `vector` 列类型。

---

## 三表层级与功能

```
knowledge_bases（知识库）      ← 顶层：一个知识库
   └── documents（文档）        ← 中间：库里的一篇文档
          └── chunks（切片）    ← 底层：文档被切成的检索单元
```

| 表 | 一句话功能 | 关键点 |
|----|-----------|--------|
| `knowledge_bases` | 知识库本身 | `user_id` 预留多用户隔离 |
| `documents` | 文档 + 原始 markdown | `content` 存原文（支持下载） |
| `chunks` | 检索的最小单元 | `embedding vector(1024)` + 切片文本 |

## 完整 Schema 代码

```ts
import { pgTable, uuid, varchar, text, jsonb, timestamp, integer, index, vector } from 'drizzle-orm/pg-core'

// 切片图片元数据（URL 进元数据列，不进向量）
export type ChunkImage = { url: string, alt: string }

export const knowledgeBases = pgTable('knowledge_bases', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description').notNull().default(''),
  userId: uuid('user_id'), // 预留：多用户隔离
  createdAt: timestamp('created_at').defaultNow().notNull()
})

export const documents = pgTable('documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  kbId: uuid('kb_id').references(() => knowledgeBases.id, { onDelete: 'cascade' }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  sourceType: varchar('source_type', { length: 50 }).notNull().default('markdown'), // 预留：格式扩展
  content: text('content').notNull(), // 原始 markdown
  createdAt: timestamp('created_at').defaultNow().notNull()
}, table => ({
  kbIdx: index('idx_documents_kb_id').on(table.kbId)
}))

export const chunks = pgTable('chunks', {
  id: uuid('id').defaultRandom().primaryKey(),
  docId: uuid('doc_id').references(() => documents.id, { onDelete: 'cascade' }).notNull(),
  kbId: uuid('kb_id').references(() => knowledgeBases.id, { onDelete: 'cascade' }).notNull(),
  chunkIndex: integer('chunk_index').notNull(), // 块序号：保证原文顺序 + 引用溯源
  content: text('content').notNull(), // 切片文本（参与向量化）
  embedding: vector('embedding', { dimensions: 1024 }), // 1024 维向量（pgvector）
  embeddingModel: varchar('embedding_model', { length: 100 }), // 预留：模型切换
  contextualText: text('contextual_text'), // 阶段 C：Contextual Retrieval
  images: jsonb('images').$type<ChunkImage[]>() // 图片元数据（不参与向量化）
}, table => ({
  docIdx: index('idx_chunks_doc_id').on(table.docId),
  kbIdx: index('idx_chunks_kb_id').on(table.kbId)
}))
```

## 列功能逐表说明

### chunks —— 最值得理解的一张表

| 列 | 干什么 | 设计意图 |
|----|--------|---------|
| `docId` | 切片属于哪篇文档 | 级联删除：删文档 → 自动删所有切片（即「删文档级联删向量」） |
| `kbId` | 切片属于哪个知识库 | **冗余存一份**：检索时直接按 kbId 过滤，避免 JOIN |
| `chunkIndex` | 块序号 | 保证切片顺序 = 原文顺序；引用溯源定位「第几段」 |
| `content` | 切片文本 | **参与向量化**的内容（区别于 documents.content 原文） |
| `embedding` | `vector(1024)` | 向量列，检索靠它；和 content 是同一行的两个列 |
| `embeddingModel` | 用了哪个模型 | 预留：不同模型向量空间不兼容，换模型时识别旧数据 |
| `contextualText` | 预生成上下文 | 阶段 C Contextual Retrieval，现在空着 |
| `images` | 图片元数据 | 决策 7：URL 不进向量，阶段 A 不碰 |

## 新语法点（通用 Drizzle 语法见 [[drizzle-orm]]）

### 1. `vector` 类型 —— pgvector 加的列类型

```ts
embedding: vector('embedding', { dimensions: 1024 })
```

- 来自 `drizzle-orm/pg-core`（0.45.2 起支持），对应 SQL 的 `VECTOR(1024)` 列
- **前置条件**：数据库必须已 `CREATE EXTENSION vector`，否则建表报 `type "vector" does not exist`
- `dimensions: 1024` 声明向量长度（维度）。**不可逆**：改维度 = 重建全库

### 2. `.$type<T>()` —— 纯 TS 类型标注，不影响数据库

```ts
images: jsonb('images').$type<ChunkImage[]>()
```

- 在 DB 里就是普通 `JSONB` 列，存啥都行
- `$type<ChunkImage[]>()` 只告诉 TypeScript「读出来是 `{ url, alt }[]`」，换来补全和类型检查
- **对数据库结构零影响**——删掉它，建表 SQL 一模一样

### 3. 外键的 `() =>` 惰性求值

```ts
kbId: uuid('kb_id').references(() => knowledgeBases.id, { onDelete: 'cascade' })
```

- 不直接写 `knowledgeBases.id`，而用函数 `() => knowledgeBases.id` 包一层
- 原因：**惰性求值**，不怕被引用的表还没定义（Drizzle 固定写法）
- `{ onDelete: 'cascade' }` = 删主表自动删从表，这是「删知识库级联删文档删切片」的实现

## 预留列：为什么建表一次加齐

`userId` / `sourceType` / `embeddingModel` / `images` 四个列**现在都不填**，但建表时就加了。原因：**给已有表加列要写迁移，建表时多写一行几乎零成本**——设计文档的硬性要求「建表时一次加齐」。

| 预留列 | 表 | 何时兑现 |
|--------|----|---------|
| `user_id` | knowledge_bases | 加 auth、多用户隔离 |
| `source_type` | documents | 支持 PDF/Word 时 |
| `embedding_model` | chunks | 换 embedding 模型时增量重算 |
| `images` | chunks | 阶段 B 图片展示 |

## 相关文档

- [[drizzle-orm]] — 通用建表语法（pgTable、类型函数、修饰符、索引）
- [[pgvector]] — 向量列 vs 标量列、距离运算符、为什么顺序扫描优于索引
- [RAG 知识库完整设计](../dev-log/2026-08-19-rag-knowledge-base-design.md) — 三表的设计论证
- [本地开发库迁移 Docker](../dev-log/2026-08-30-local-db-docker-migration.md) — 启用 pgvector 的前置操作
