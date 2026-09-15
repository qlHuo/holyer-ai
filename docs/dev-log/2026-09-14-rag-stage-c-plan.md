# 2026-09-14 — RAG 阶段 C（质量增强）实施规划：三步拆解与排序

> 核心洞察：阶段 C 的三件事不是平行的，**按「改动半径」排序**才是对的 —— 3.9/3.11 只加东西、不改向量，3.10 要**重算全部 embedding**。越靠后越贵，所以最贵的压最后；再把「加列」的两步排在重灌之前，让 3.10 一次写齐所有元数据。

---

## 讨论背景

[RAG 知识库完整设计](2026-08-19-rag-knowledge-base-design.md) 已把阶段 C 定为「质量增强」，并给出三项：混合检索（决策 3）、Contextual Retrieval（决策 4）、引用溯源（决策 6）。阶段 A（管道验证，12 问召回 92%）与阶段 B（产品化，2026-09-09 收官）均已完成，[roadmap](../../.claude/plan/roadmap.md) 阶段 C 三项仍为 ⬜。

本文补上设计文档缺的那一层：**这一步到底分几步、什么顺序、每一步的背景、需求、方案与流程**。设计文档回答「做什么」，本文回答「怎么做、先做哪个」。

---

## 现状锚点（阶段 C 的起点）

当前检索链路是一条没有任何增强层的直线（[knowledge-base-search.ts](../../server/service/agent/tools/builtin/knowledge-base-search.ts)）：

```
search_knowledge_base.execute()
  → embedText(query)                    // embeddings.ts
  → searchChunks(db, vec, {topK:5})     // retriever.ts —— 单条 SQL，纯余弦距离
  → 拼成 "[来源：标题]（相似度 0.87）\n内容" → 作为 tool 消息回灌
```

[retriever.ts:83-98](../../server/service/rag/retriever.ts#L83-L98) 是唯一检索 SQL：`1 - (embedding <=> vec) AS score` + `ORDER BY 距离` + `LIMIT topK`，**没有全文检索、没有融合、没有引用元数据回传**。

Schema 现状（[schema.ts:46-81](../../server/db/schema.ts#L46-L81)）：

| 列 | 状态 | 服务于 |
|----|------|--------|
| `chunks.contextual_text` | ✅ 已预留（阶段 A 建表） | 3.10 |
| `chunks.images` | ✅ 已用（阶段 B M3） | — |
| `chunks.heading_path` | ❌ 缺失 | 3.11 |
| `documents.source_url` | ❌ 缺失 | 3.11（GitHub 回链） |
| 全文检索列 / GIN 索引 | ❌ 缺失 | 3.9 |

> 关键事实：[chunker.ts](../../server/service/rag/chunker.ts) 其实**已提取** `headingPath`，但 [ingest.ts:69-71](../../server/service/rag/ingest.ts#L69-L71) 只把它拼进 `content` 前缀参与向量化，**结构化数据没落库**。这是 3.11 的第一个缺口。

---

## 排序决策：为什么是 3.9 → 3.11 → 3.10

| 步骤 | 改动半径 | 是否重灌库 | 主要风险 | 顺序 |
|------|---------|:--:|------|:--:|
| **3.9** 混合检索 | retriever + 索引列 | ❌ 仅建索引/分词回填 | 中文分词方案 | **1** |
| **3.11** 引用溯源 | 元数据 + 渲染 | ⚠️ 轻量回填（两列） | citation 白名单安全 | **2** |
| **3.10** Contextual Retrieval | ingest 全链路 + 离线管道 | ✅ **全量重算向量** | 成本 + CF 配额 | **3** |

三条理由：

1. **3.9 最少副作用** —— 只改 [retriever.ts](../../server/service/rag/retriever.ts) 与加索引列，**不触碰已有 embedding**，风险最小，先落地。
2. **3.11 次之** —— 输出/渲染侧（citation、`sourceUrl`），一次轻量回填，不动向量；且越早做，3.10 全量重灌时能**一趟写齐** `heading_path` / `source_url`，省一次回填。
3. **3.10 压最后** —— 它要求**全量重新分块 + 重新 embedding**（所有 chunk 重算）。必须等语料/分块策略稳定后再做，否则返工白花钱。改动半径最大、成本最高。

> 与设计文档默认顺序（3.9→3.10→3.11）的差异：设计文档按「功能重要性」列，本文按「改动半径」排。功能上三者独立，实施上排错顺序会多花一次全量重灌的钱。

---

## 3.9 混合检索

### 背景 / 原因分析

纯向量检索对**精确术语、代码标识符、专有名词**召回差。问 `drizzle-orm/neon-http` 这种精确字符串，向量相似度可能排不到前面；而全文检索按词命中则稳。设计文档决策 3 已把混合检索定为目标方案。

阶段 A 的 12 问召回 92%，唯一 miss 是「跨文件综合题」——**注意：那不是精确词问题**，混合检索对它帮助有限（那是 3.10 的靶子）。所以 3.9 是**正交增强**（救精确串），不是救火。

### 需求分析

- 提升精确词/代码标识符召回，与现有向量召回**互补**（不是替换）
- **零新增依赖**（Edge Runtime 铁律）且 Neon 免费层可承载
- **不改上层**：工具 / 端点 / 前端不动 —— 设计文档扩展性表已预留 `Retriever` 接口 + `SearchResult.source` 字段
- **不重新 embedding**（与 3.10 区分），最多重新分词回填

### 方案确认

**召回两路 → RRF 融合**。`score = Σ 1/(k + rank_i)`，k=60（业界默认）；两路各取 top-20 → 融合出 top-5。RRF 优点：只用「排名」不用「分数」，天然回避两路分数不可比的坑。

**中文分词是本步唯一先决风险**。PostgreSQL 原生 `to_tsvector` 对中文无效（无空格 → 整句一个 token）。三条路线：

| 路线 | 可行性 | 结论 |
|------|--------|------|
| `pg_jieba` / `zhparser` 扩展 | ❌ | 需 superuser 装扩展，**Neon 免费层装不了** → 排除 |
| **入库期预分词 + `to_tsvector('simple', 分词结果)`** | ✅ | 用 `Intl.Segmenter('zh', {granularity:'word'})` —— **Edge Runtime 内置、零新依赖**。存一列空格分隔的分词文本，查/写两侧同法 |
| `pg_trgm` 三元组 + `ILIKE` | ⚠️ | 对子串匹配有效、Neon 支持，但排序质量不如真分词 → 退路 |

**确认走路线 2**（`Intl.Segmenter`）。注意：query 侧也要用同一分词器，保证两侧落在同一分词空间。

### 实现大体流程

1. **迁移**：`chunks` 加一列分词文本（入库期由 `Intl.Segmenter` 生成）+ 建 GIN 索引；回填现有 chunks（**只需重新分词，不重新 embedding**，便宜）
2. **Service 拆分** [retriever.ts](../../server/service/rag/retriever.ts)：
   - `searchByVector()` —— 现有逻辑原样保留、改名
   - `searchByKeyword()` —— 新增，`ts_rank` 排序
   - `hybridSearch()` —— `Promise.all` 两路并行 → RRF 融合，`SearchResult.source` 标注 `vector | keyword | both`
3. **调用方**：[knowledge-base-search.ts:56](../../server/service/agent/tools/builtin/knowledge-base-search.ts#L56) 改调 `hybridSearch`，工具层其余不动

### 实测结果（2026-09-15，本地）

实施方案与本节基本一致，落成后新增 `scripts/eval-retrieval.ts` 的 `exactCases`（9 题精确术语）做三模式对比：

| 模式 | concept 命中 | exact 命中 | 字面量命中 | MRR(concept) | MRR(exact) |
|------|:--:|:--:|:--:|:--:|:--:|
| `vector`（旧） | 11/12 (92%) | 9/9 | 8/9 | 0.813 | 0.926 |
| `keyword`（仅全文） | 9/12 (75%) | 9/9 | 8/9 | 0.628 | 0.944 |
| **`hybrid`（新）** | **11/12 (92%)** | 9/9 | 8/9 | 0.783 | **1.000** |

关键读数：**concept 命中率与旧纯向量持平（无回退）**；**exact MRR 0.926 → 1.000**（精确词命中全部排到 #1）。`keyword` 单独使用时 concept 掉到 75% —— 印证了必须**混合**而非替换（全文不懂语义）。

落地时的三处与本节设想的偏差：① 分词列名 `content_tokens`，另配**生成列** `content_tsv`（而非把分词文本直接当索引表达式）；② tsquery 用 `replace(plainto_tsquery(...)::text, ' & ', ' | ')` 取 OR 语义（`to_tsquery` 手工拼 token 会因标识符里的 `:` `-` `/` 报语法错）；③ 存量回填另写脚本 `scripts/backfill-tokens.ts`（只重分词、不重新 embedding），用 **keyset 分页**避免 `OFFSET` 在结果集缩小下漏行（见 [drizzle-orm 笔记](../learning-notes/drizzle-orm.md) 批量回填模式）。已知待改进：`contextual_text` 那道字面量题，混合检索的 top-5 被「两路都靠前」的 chunk 占满，纯关键词独中的 chunk 会被挤出（RRF 的固有取舍，可后续调 `candidates`/`topK`）。

---

## 3.11 引用溯源

### 背景 / 原因分析

引用溯源是「RAG 产品体验的关键，成本低」（设计文档决策 6）—— 检索返回的片段带来源元数据，LLM 回答标注来源，前端可点击跳转。

两个现存缺口：

1. **`headingPath` 被丢弃**：chunker 已提取，ingest 拼进 content 前缀后就没落库（见「现状锚点」）
2. **无 `sourceUrl`**：GitHub 引入的文档（3.7）回链应该到 GitHub 原文而非本系统。[09-09 GitHub 引入定稿](2026-09-09-github-doc-import-plan.md) 明确把 `sourceUrl` 类字段**留给 3.11 一并设计**，避免当时写迁移换一个无人消费的列

### 需求分析

- 答案可见地标注来源（标题 + 位置），可追溯到具体 chunk/标题
- **安全**：citation 链接是 **LLM 生成的** → 必须校验 docId 属于**本轮检索结果集合**，防 LLM 编造/文档注入伪造链接。这与图片白名单**完全同构**
- **与 3.7 联动**：GitHub 来源文档回链到 GitHub 原文

### 方案确认

- **数据**：`chunks` 加 `heading_path`（结构化标题路径）；`documents` 加 `source_url`（GitHub 引入时写 `github.com/{owner}/{repo}/blob/{branch}/{path}`，[app/utils/github.ts](../../app/utils/github.ts) 已有改写上下文）
- **渲染**：自定义内部 scheme（如 `kb://doc/{id}#chunk-{i}`）由 [markdown.ts](../../app/utils/markdown.ts) 专门规则拦截，渲染为可点击 chip → 复用 `GET /api/rag/documents/:id` 下载/跳转
- **安全**：新增 `allowedCitations` 白名单 Set，按本轮 `search_knowledge_base` 返回的 doc 集合注入 —— 与 [markdown.ts:102-118](../../app/utils/markdown.ts#L102-L118) 的 `allowedImages` 同构
- **注意**：[markdown.ts:72-85](../../app/utils/markdown.ts#L72-L85) 的 `link_open` 已给 http(s) 外链加 `target=_blank`，自定义 scheme 要在它之前拦截

### 实现大体流程

1. **迁移**：加 `chunks.heading_path` + `documents.source_url` 两列
2. **写入侧**：ingest 写 `headingPath`；GitHub 引入写 `sourceUrl`
3. **检索侧**：`SearchResult` 补 `headingPath`（`documentId`/`chunkIndex` 已有）
4. **工具 + Prompt**：格式化输出带 citation 标记（如 `[1] 标题 § 小节`），并在工具描述/prompt 要求 LLM 标注来源
5. **前端**：`markdown.ts` 加 citation 渲染规则 + `allowedCitations` 白名单校验

---

## 3.10 Contextual Retrieval

### 背景 / 原因分析

每个 chunk 单独看是「无上下文的碎片」。先让 LLM 给每个 chunk 生成一句说明（「这是 ADR-008 中关于为什么否决 Vercel AI SDK 的段落…」），拼在 chunk 前一起向量化，**检索失败率约降 49%**（Anthropic 数据）—— 正对症阶段 A 唯一的「跨文件综合题」miss。

现状其实已有**弱版**：[ingest.ts:69-71](../../server/service/rag/ingest.ts#L69-L71) 已把 `headingPath` 拼进 `content` 参与向量化。3.10 的增量是「**LLM 生成的语义上下文**」，`chunks.contextual_text` 列阶段 A 就预留了。

### 需求分析

- **必须全量重建向量**：新旧向量空间不一致会导致检索失效，无法只增量做 → 这是「最后做」的根本原因
- 成本可控（个人语料千级 chunk，一次性成本极低）
- **CF subrequest 铁律（核心约束）**：每 chunk 一次 LLM 调用，58 篇 ≈ 千级 chunk ≈ **1000+ 次调用**。若在**上传 API 内同步生成**，单篇文档的 chunk 数 × 调用数会打爆 **50 subrequest/请求** 上限（项目已踩过，见 [CF subrequest 超限](2026-09-01-cf-workers-subrequest-limit.md)）

### 方案确认

- **生成走离线脚本**（本地 Node，无 subrequest 限制）；上传 API 只能是「先无 context 入库 → 后台补 contextual + 重算 embedding」的两阶段
- **上下文来源**：Anthropic 原方案把整篇文档塞进 prompt，长文档费 token。可先只对长/复杂文档做 LLM 生成，其余沿用 `headingPath` 弱上下文，渐进投入
- **验证**：重跑阶段 A 的 12 问评测集（尤其综合题），对比 92% 基线 —— 对应横切关注点 **X4 行为评估**

### 实现大体流程

1. **脚本**：逐 chunk 调 LLM 生成 context（批量 + 并发控制 + 断点续跑）
2. **落库**：写 `chunks.contextual_text`
3. **重算向量**：用 `{contextualText}\n{content}` 重新 embedding
4. **回填**：全量写回；顺带确认 3.9 的全文索引是否要把 contextualText 纳入

---

## 关键洞察

- **排序应看「改动半径」而非「功能重要性」** —— 三项功能独立，但 3.10 会重算一切，排错顺序就多花一次全量重灌的钱。
- **先做「加列」的两步（3.9/3.11）再做重灌（3.10）**，让重灌一次性写齐所有新列，省一次回填。
- **中文分词是 3.9 的隐藏关卡** —— PostgreSQL 原生 tsvector 不分中文，而 Neon 装不了分词扩展；`Intl.Segmenter` 是 Edge 环境里「零依赖」的正解。
- **citation 与图片白名单是同一套安全模型** —— 凡是 LLM 生成的「外部引用」，都必须按本轮检索结果集合白名单放行。
- **阶段 C 每一步都要挂回评估集** —— 复用阶段 A 的 12 问脚本，否则「命中率提升」无法证明。

## 相关文档

- [RAG 知识库完整设计](2026-08-19-rag-knowledge-base-design.md) — 决策 3（混合检索）/ 4（Contextual Retrieval）/ 6（引用溯源）、Schema、三阶段路径
- [RAG 阶段 A 落地](2026-08-31-rag-stage-a-implementation.md) — 12 问 92%、跨文件综合题 miss 留档
- [RAG 阶段 B 实施方案](2026-09-02-rag-phase-b-implementation.md) — 三阶段衔接
- [GitHub 文档引入定稿](2026-09-09-github-doc-import-plan.md) — `sourceUrl` 留给 3.11 的约定
- [CF Workers subrequest 超限](2026-09-01-cf-workers-subrequest-limit.md) — 3.10 的配额铁律依据
- [知识库图片展示边界](2026-08-26-rag-image-display-boundary.md) — 白名单渲染安全模型（citation 复用）
- [pgvector 笔记](../learning-notes/pgvector.md) · [embedding-dimensions](../learning-notes/embedding-dimensions.md) · [rag-schema](../learning-notes/rag-schema.md)
- [混合检索：向量 / 全文 / RRF](../learning-notes/hybrid-retrieval.md) — 3.9 的算法原理（两种召回的作用与局限、RRF 拆解）
- [实施路线图](../../.claude/plan/roadmap.md) — Phase 3 阶段 C 任务 3.9–3.11
