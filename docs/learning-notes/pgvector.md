# pgvector 笔记 — 向量列、标量列与检索原理

> 核心认知：**pgvector 不是数据库，是 PostgreSQL 的一个扩展**。它只做了一件事——给 PG 加一个 `vector` 列类型和几个距离运算符。理解这一点，后面所有困惑都会消失。

---

## 一、它到底是什么

```sql
CREATE EXTENSION vector;   -- 一行，就这样
```

装完之后 PG 多了：

- 一个新列类型 `vector(N)`
- 几个距离运算符（`<->`、`<=>`、`<#>` …）
- 两种向量索引（HNSW、IVFFlat）

**没有新服务、没有新连接、没有新 SDK、没有新计费。** 这是本项目选它而非 Pinecone/Weaviate/Milvus 的根本原因（详见 [RAG 设计文档](../dev-log/2026-08-19-rag-knowledge-base-design.md)「向量存储选型」）。

---

## 二、向量列 vs 标量列

### 各家的叫法对照

「标量字段」是向量数据库的正式术语，指**非向量的那些字段**：

| 系统 | 非向量字段叫什么 |
|---|---|
| Milvus | 标量字段（scalar field） |
| Pinecone | metadata |
| Qdrant | payload |
| Weaviate | properties |
| **pgvector** | **就是普通的表列** |

前四个是专用向量数据库，它们在架构上把「向量」和「其他一切」分开存储和处理，所以需要专门造个词来指代后者。

pgvector 不需要这个词。在 PG 眼里，`embedding vector(1024)` 和 `images jsonb` 地位完全平等，都是普通列，住在同一张表的同一行里。

> 所以当你在别处读到「把元数据存进标量字段」，在 pgvector 语境下翻译过来就是：**多加几个普通列**。

---

## 三、向量和普通数据怎么关联：它们本来就是同一行

这是初学时最容易卡住的地方，而答案简单到有点反直觉——**不需要关联，因为它们从来没分开过。**

```sql
CREATE TABLE chunks (
  id           uuid PRIMARY KEY,
  document_id  uuid REFERENCES documents(id) ON DELETE CASCADE,
  content      text NOT NULL,        -- 切片文本（被向量化的那段原文）
  embedding    vector(1024),         -- ← 向量列
  images       jsonb DEFAULT '[]',   -- ← 元数据列
  chunk_index  int
);
```

检索时：

```sql
SELECT content, images, 1 - (embedding <=> $queryVec) AS score
FROM chunks
ORDER BY embedding <=> $queryVec   -- ← 只有这一行用到了向量
LIMIT 5;
```

看清楚这里发生了什么：

| 步骤 | 谁参与了 |
|---|---|
| `<=>` 计算距离 | **只有 `embedding` 列** |
| `ORDER BY` 排序 | 距离值，决定哪 5 行胜出 |
| `SELECT` 取数 | 胜出行的**整行**——`content`、`images` 顺带被捞上来 |

`images` 从头到尾没参与任何计算。**它只是坐在那一行里，等着它的行被选中。**

### 图书馆比喻

**向量是索书号，用来在书架间定位；书名、作者、插图页码印在同一张卡片上。**

索书号只负责"找到哪张卡"，找到之后整张卡的信息都归你了。不存在"卡片和索书号怎么关联"的问题——它们本来就印在一起。

### 推论：什么该进向量，什么该进元数据

| 内容性质 | 去处 | 原因 |
|---|---|---|
| 人写给人看的文字 | `content`（参与向量化） | 有语义，是检索的依据 |
| 机器寻址用的 URL / ID | 元数据列 | 无语义，进向量只会**稀释语义密度** |

这条推论直接决定了 chunker 怎么写：markdown 图片 `![架构图](https://.../arch.png)` 要拆成两半——「架构图」进 `content`，URL 进 `images`。把一长串 URL 喂进 embedding，等于往索书号的计算依据里掺沙子。

---

## 四、距离运算符

| 运算符 | 含义 | 何时用 |
|---|---|---|
| `<=>` | 余弦距离 | **文本 embedding 默认选它** |
| `<->` | L2 / 欧氏距离 | 向量未归一化时 |
| `<#>` | 负内积 | 追求性能，向量已归一化 |

**余弦相似度 = 1 - 余弦距离**，所以上面 SQL 里写 `1 - (embedding <=> $vec) AS score`，得到 0~1 的相似度分值。

> 主流文本 embedding 模型（含 qwen3.7）输出的向量都已归一化，此时余弦距离和内积的**排序结果一致**，选哪个不影响召回，只影响计算开销。

---

## 五、索引：不建反而更准

这是最反直觉的一点。

**不建索引时，pgvector 做的是精确的顺序扫描**——遍历所有行算距离，返回真正的 top-k，召回率 100%。

**建了索引（HNSW / IVFFlat）之后是近似最近邻（ANN）**——用图结构或聚类跳过大部分行，快得多，但**可能漏掉真正的最近邻**。

| | HNSW | IVFFlat |
|---|---|---|
| 召回率 | 高 | 中 |
| 查询速度 | 快 | 快 |
| 内存占用 | 大 | 小 |
| 构建速度 | 慢 | 快 |
| 前置条件 | 无 | **需表中已有数据**（靠数据聚类） |

**索引换的是速度，代价是召回率。** 几百个 chunk 时顺序扫描就是毫秒级，建索引纯属负优化——既费内存又损召回。

本项目的策略（见设计文档）：**阶段 A/B 不建索引**，规模涨到几千 chunk 再上 IVFFlat。

> Neon 免费版约束：HNSW 索引约 5 万行上限、向量维度上限 1536 维。项目锁 1024 维，安全。

---

## 六、维度是不可逆的

```sql
embedding vector(1024)   -- 这个 1024 定死了
```

两条铁律：

1. **改维度 = 重建全部索引和数据**。没有平滑迁移路径。
2. **同一张表里的向量必须来自同一个 embedding 模型**。不同模型的向量空间互不兼容，混用会让检索静默失效——不报错，只是结果变成噪声。

所以 `chunks` 表要留 `embedding_model` 列：将来换模型时能识别出哪些行是旧模型算的，支持增量重算而不是全表推倒。

---

## 七、常见误区速查

| 误区 | 实际 |
|---|---|
| pgvector 是个向量数据库 | 是 PG 扩展，一个列类型而已 |
| 向量和元数据要做关联查询 | 同一行，`SELECT` 天然带出，无需 JOIN |
| 元数据也要向量化才能被检索到 | 元数据不参与计算，只是随行被取出 |
| 把 URL 一起向量化没关系 | 会稀释语义密度，拉低召回排名 |
| 建索引总是更好 | 几百行时顺序扫描更准更快 |
| 维度选大一点更保险 | 不可逆、费存储，且 Neon 免费版 1536 维封顶 |

---

## 八、与 Drizzle 的结合

Drizzle ORM 的 `pg-core` 提供了 `vector` 类型：

```ts
import { pgTable, uuid, text, jsonb, vector } from 'drizzle-orm/pg-core'

export const chunks = pgTable('chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 1024 }),
  images: jsonb('images').$type<{ url: string, alt: string }[]>().default([])
})
```

> ⚠️ **待验证**：本项目安装的 Drizzle 版本是否支持 `vector` 类型（该类型在较新版本引入），以及 `drizzle-kit push` 能否自动处理 `CREATE EXTENSION vector`。**在 Phase 3 任务 3.1 实际建表时确认**，若不支持则手动写 SQL 迁移。

---

## 相关文档

- [RAG 知识库完整设计](../dev-log/2026-08-19-rag-knowledge-base-design.md) — 本项目的 Schema、维度选型、Neon 配额实测
- [知识库图片展示边界](../dev-log/2026-08-26-rag-image-display-boundary.md) — 为什么 URL 要进元数据而非向量
- [Embedding 维度与 Matryoshka](embedding-dimensions.md) — 模型侧：能力上限 vs 锁定维度、为什么低维不亏
- [Drizzle ORM 笔记](drizzle-orm.md) — Schema 定义与 CRUD 基础
- [Drizzle Kit 笔记](drizzle-kit.md) — push / generate / migrate 工作流
- [ADR-003](../decisions/003-neon-drizzle.md) — 选择 Neon + Drizzle，向量搜索定 pgvector
