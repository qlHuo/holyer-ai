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
import { pgTable, uuid, varchar, text, jsonb, timestamp, integer, index, vector, customType } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// 切片图片元数据（URL 进元数据列，不进向量）
export type ChunkImage = { url: string, alt: string }

// drizzle-orm 无 tsvector 类型，customType 兜底（仅用于生成迁移 DDL；运行时查询走 raw SQL）
const tsvector = customType<{ data: string, driverData: string }>({
  dataType() { return 'tsvector' }
})

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
  sourceType: varchar('source_type', { length: 50 }).notNull().default('markdown'), // 来源通道（local/github/manual；'markdown' 为历史遗留默认）
  content: text('content').notNull(), // 原始 markdown
  sourceUrl: text('source_url'), // 3.11：原文链接（仅 GitHub 引入有），引用回链用
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
  images: jsonb('images').$type<ChunkImage[]>(), // 图片元数据（不参与向量化）
  headingPath: jsonb('heading_path').$type<string[]>(), // 3.11：结构化标题路径（H1→当前节），引用溯源用
  contentTokens: text('content_tokens'), // 3.9 全文检索：分词结果（原料），可空无 default —— NULL 是回填游标
  contentTsv: tsvector('content_tsv') // 3.9 全文检索：生成列（成品），PG 自动从 content_tokens 派生
    .generatedAlwaysAs(sql`to_tsvector('simple', content_tokens)`)
}, table => ({
  docIdx: index('idx_chunks_doc_id').on(table.docId),
  kbIdx: index('idx_chunks_kb_id').on(table.kbId),
  tsvIdx: index('idx_chunks_content_tsv').using('gin', table.contentTsv)
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
| `contextualText` | 预生成上下文 | 阶段 C 3.10 Contextual Retrieval，现在空着 |
| `images` | 图片元数据 | 决策 7：URL 不进向量，阶段 B 已兑现（白名单渲染） |
| `headingPath` 🆕 | 结构化标题路径 | 3.11：chunker 早就提取了它，但此前只被拼进 `content` 前缀就丢弃；现在另存一份结构化数据供引用溯源 |
| `contentTokens` 🆕 | 分词结果（**原料**） | 3.9：应用写入，空格分隔的词元串 |
| `contentTsv` 🆕 | `tsvector`（**成品**） | 3.9：**生成列**，从 `content_tokens` 自动派生 + GIN 索引 |

## 3.9 全文检索两列：原料与成品

`content_tokens` 与 `content_tsv` 是**一对**：前者是原料（应用写入），后者是成品（PG 派生）。分清「哪个阶段碰哪个列」是理解这块的钥匙：

| 阶段 | 碰哪个列 | 谁在用 |
|---|---|---|
| 新文档入库 | **写** `content_tokens` | `ingest.ts`（经 `tokenizer.toIndexedText`） |
| 存量回填 | **读写** `content_tokens` | `scripts/backfill-tokens.ts` |
| 入库/回填之后 | `content_tsv` **自动生成** | PostgreSQL（生成列） |
| **检索** | **只读** `content_tsv` | `retriever.ts` 的 `searchByKeyword` |

> 一句话：**`content_tokens` 只活在写入阶段；检索永远只读 `content_tsv`。** 中间那一跳由生成列自动完成。

## 3.11 新增两列：为什么用 jsonb 而不是数组

`chunks.heading_path` 存的是字符串数组（H1→当前节的祖先链），但类型选了 `jsonb` 而非 PG 原生 `text[]`：

- **双驱动形状差异**：本地 dev 走 `postgres-js`、生产走 `neon-http`，两者对部分 PG 类型的反序列化行为不完全一致。`images` 列已经踩过这条路——检索层的原始 SQL 里写着 `c.images::text`，取出来再在 JS 侧 `JSON.parse`，就是为了规避这个差异
- **`text[]` 是本项目从未用过的类型**，两个驱动的数组返回形状未经验证；而 jsonb 的读写路径已被 `images` 在生产验证过
- 代价：读取时要多一步 `::text` 再 parse。这点开销换掉一整类不确定性，划算

`documents.source_url` 是普通 `text`，无此顾虑。

> 存量数据的 `heading_path` 由回填脚本补齐。回填方式是**重新分块推导**而不是从 `content` 的标题前缀反推——前缀确实拼着 `headingPath.join(' > ')`，但正文首行恰好长成那个形状就会误判；重算是纯函数、完全确定性，且不重算 embedding。详见 [引用溯源落地记录](../dev-log/2026-09-17-citation-implementation.md)。

- **为什么必须两列**：PostgreSQL 不认识中文 —— `to_tsvector('simple', 中文原文)` 会把整段当一个 token。所以中文切词必须在 JS 侧（`Intl.Segmenter`）先做，切好的串存 `content_tokens`，再交给 PG 转 `tsvector`。
- **为什么用生成列**：`UPDATE content_tokens` 时 PG 自动重算 `content_tsv`，不存在「列更新了、索引没跟上」。代价：**不能直接写 `content_tsv`**（会报错），且表达式必须 IMMUTABLE（所以写二参 `to_tsvector('simple', x)`）。
- **写/查必须同源**：`tokenizer.ts` 的 `toIndexedText`（写）与 `toQueryText`（查）是同一个实现 —— 否则两边不在同一分词空间，检索**静默失效**（不报错）。改分词规则要递增 `TOKENIZER_VERSION` 并 `--force` 全量重分词。

> 原理详见 [混合检索笔记](hybrid-retrieval.md) 第四、五节。

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

| 预留列 | 表 | 兑现情况 |
|--------|----|---------|
| `user_id` | knowledge_bases | ⬜ 加 auth、多用户隔离 |
| `source_type` | documents | ✅ **语义已改**为「来源通道」`local`/`github`/`manual`（2026-09-09）—— 原设想的 PDF/Word 已明确不做 |
| `embedding_model` | chunks | ⬜ 换 embedding 模型时增量重算 |
| `images` | chunks | ✅ 阶段 B 已兑现（图片白名单渲染） |
| `heading_path` / `source_url` | chunks / documents | ✅ 阶段 C 3.11 兑现（引用溯源）——**不是预留列**，是这一阶段新增的 |

## 相关文档

- [混合检索：向量 / 全文 / RRF](hybrid-retrieval.md) — `content_tokens`/`content_tsv` 在检索链路里的用法、RRF 融合
- [[drizzle-orm]] — 通用建表语法（pgTable、类型函数、修饰符、索引）
- [[pgvector]] — 向量列 vs 标量列、距离运算符、为什么顺序扫描优于索引
- [RAG 知识库完整设计](../dev-log/2026-08-19-rag-knowledge-base-design.md) — 三表的设计论证
- [引用溯源落地记录](../dev-log/2026-09-17-citation-implementation.md) — `heading_path` / `source_url` 两列的用途与回填方式
- [本地开发库迁移 Docker](../dev-log/2026-08-30-local-db-docker-migration.md) — 启用 pgvector 的前置操作
