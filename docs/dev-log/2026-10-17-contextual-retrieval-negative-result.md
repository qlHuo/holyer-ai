# 2026-10-17 — Contextual Retrieval 验证结果：本语料下无可测收益，不采用

> **结论先行**：按既定实施方案完整实现了 3.10 并做了 A/B，结果是 **Contextual Embeddings 召回无提升、排序变差；Contextual BM25 明确负收益**。决定**不落地**，3.10 关闭。
>
> 这个负结果本身有价值：它暴露了两个评测设计问题，也说明「标题层级完整的技术文档」不满足这个技术的收益前提。

---

## 一、实验设置

| 项 | 值 |
|---|---|
| 语料 | 127 篇 / 2150 片（含 42 篇 GitHub 引入、1 篇手动上传） |
| 生成模型 | `deepseek-v4-flash`，`temperature=0` |
| 生成结果 | 2150/2150 全部生成，平均 78 字、最长 165 字 |
| 评测集 | 12 道 concept + 9 道 exact，**chunk 级真值**（`mustContain`） |
| 对比方式 | 向量与分词两个变量，各两档，共 4 组配置 |

`embedding_ctx` 为本地临时列（`vector(1024)`），只用于 A/B，未进 schema / 迁移 / 线上。

---

## 二、结果

| 配置 | 文档命中 | **chunk 命中** | **chunkMRR** | 文档MRR | exact 字面量 |
|---|:--:|:--:|:--:|:--:|:--:|
| **旧向量 + 旧分词（基线）** | 10/12 | **11/12** | **0.808** | **0.767** | 8/9 |
| 新向量 + 旧分词 | 11/12 | **11/12** | 0.642 | 0.742 | 8/9 |
| 新向量 + 新分词 | 10/12 | **10/12** | 0.556 | 0.722 | 8/9 |
| 旧向量 + 新分词 | 11/12 | **10/12** | 0.590 | 0.750 | 8/9 |

**读法**：

- **召回（chunk 命中）没有提升**：新向量与基线持平（11/12）；一旦把 blurb 纳入全文索引，反而掉到 10/12。
- **排序变差**：chunkMRR 从 0.808 降到 0.642（新向量）/ 0.590（新分词）。
- **文档命中 +1 是假象**：Neon 题原本就能从 `plan/technical-research` 的「3.2 选择 Neon 的理由」拿到完整答案，只是当时的 `expected` 没把它算进去。
- **exact 无变化**：精确词检索未被破坏。

---

## 三、为什么没有收益

### 1. 语料不满足这个技术的收益前提

Contextual Retrieval 针对的是「**长文档、无标题结构、片段脱离上下文后语义有洞**」的场景（Anthropic 的例子是财报、代码库、论文）。

我们的语料是技术文档：**标题层级完整**，而 [ingest.ts:73-77](../../server/service/rag/ingest.ts#L73-L77) 本来就会把 `headingPath` 拼进 `content` 参与向量化。大部分 chunk 已经自包含，「这段属于哪一节」这个信息早就有了。3.10 补的是语义层，但收益空间被结构层先吃掉了一大半。

### 2. blurb 降低了同文档内片段的区分度

新向量的 chunkMRR 下降，不是因为「找错了文档」，而是**同文档内正确片段从 #1 挪到了 #2**。抽查几条：

- Vercel 题：新 #1 是「SDK 覆盖范围」，正确片段（背景中的学习目标）落到 #2
- 国内模型题：新 #1 是「逐家分析」，直接结论「OpenAI 兼容是事实标准」落到 #2

原因是每片的 blurb 都以文档级信息开头（「位于《X》的 Y 节…」），同一篇文档的 chunk 共有这部分语义，向量彼此更接近，chunk 自身的信号被稀释。

### 3. Contextual BM25 是明确的负收益

把 blurb 纳入 `content_tokens` 后，chunk 命中从 11/12 掉到 10/12，`chunkMRR` 进一步降到 0.556，还挤掉了「流式输出」题的正确片段。

原因：blurb 里的通用词（「文档」「片段」「位于」「属于」）进入全文索引，稀释了 `ts_rank_cd`；同时让「提到了关键词」但不在正文里的片段挤进候选，降低了精确匹配的精度。

> 这与 Anthropic 配方（Contextual BM25）相反，但结论基于我们自己的分词实现和语料。**配方不能脱离语料直接套用。**

### 4. 原定靶子是无效用例

阶段 C 规划把「说明项目整体的流程，包括前后端、数据库、部署」定为 3.10 的靶子。验证后发现这道题本身不可测：

1. **它是跨文档综合题**，要求合并多篇文档的信息；而检索返回的是单个 chunk，没有哪一片能独立回答
2. 目标文档 `plan/architecture` 的 28 片里绝大多数是 **ASCII 架构图、目录树、代码块**，它描述「结构」而非「流程」
3. 问法用词（流程）与文档用词（总体架构 / 目录结构）不匹配
4. top-5 召回的 `scaffold-guide`（开发顺序）、`streaming-architecture`（数据流）**本来就是相关答案**，只是我们把标准答案人为收窄成了一篇

即便加了 blurb，`plan/architecture` 也只从「top-20 未命中」提升到**向量第 11 名**（全文路仍未命中），融合后进不了 top-5。**提升是真实存在的，但幅度不足以改变结果。**

---

## 四、顺带修正的评测问题

验证过程中发现了两个测试用例本身的问题，已修复（[eval-retrieval.ts](../../scripts/eval-retrieval.ts)）：

| 问题 | 修复 |
|---|---|
| Neon 题的 `expected` 只有 `neon-drizzle`，漏掉了同样含完整答案的 `plan/technical-research` | expected 补上 `technical-research` |
| 「说明项目整体的流程…」是综合题，无唯一正确答案 | 替换为「项目的目录结构是怎样的？」，真值 `Nuxt 4 前端目录` |

**修复后基线**：

```
concept：12/12 (100%), chunk 12/12 (100%)｜chunkMRR 0.825｜文档MRR 0.825
exact  ：9/9 (100%), 字面量 8/9 (89%)｜文档MRR 1.000
```

**这说明：此前记录的「检索失败」全部来自评测用例，而不是检索系统。** 这个教训比 3.10 本身更重要。

---

## 五、回退记录（2026-10-17）

不采用的同时，已把 3.10 的实现完整回退到动手之前：

| 对象 | 处理 |
|---|---|
| `server/service/rag/contextualizer.ts` | **已删除** |
| `scripts/backfill-contextual.ts` | **已删除** |
| `scripts/inspect-retrieval.ts` | **已删除**（本轮为 3.10 新建的诊断工具） |
| `scripts/_debug-llm.ts` | **已删除**（临时诊断脚本） |
| `server/service/rag/retriever.ts` | **已还原**（移除 `embeddingColumn` 选项） |
| [eval-retrieval.ts](../../scripts/eval-retrieval.ts) | **保留** chunk 级断言、`--dump` 与用例修正；移除 `--embedding=ctx` A/B 开关 |
| `chunks.contextual_text` | **列保留**（阶段 A 建表时就存在），**数据已清空**（2150 → 0） |
| `chunks.embedding_ctx` | 已删除（临时实验列） |
| `chunks.content_tokens` / `content_tsv` | 已恢复为不纳入 blurb 的版本 |
| `chunks.embedding` | 从未被改写 |

> 回退后基线：`concept 12/12 (100%)｜chunkMRR 0.825｜exact 字面量 8/9, MRR 1.000`。

**保留的文档**：仅本文（实施方案已随回退删除）。关键实现参数折叠在 §8「重实现要点」中，重新验证时照此重建即可。

---

## 六、什么情况下值得重新验证（未来优化点）

> 重新验证前，需按 §8「重实现要点」恢复被回退的代码（`contextualizer.ts` + `backfill-contextual.ts`）。

1. **语料形态改变**：出现大量无标题、长段落、跨页的文档（如 PDF/OCR 转出的文本）
2. **引入 rerank**：如果先解决「召回到了但排序靠后」的问题，再考虑上下文增强
3. **换成更克制的 blurb 设计**：只写指代消解、不写文档位置，并且只在**真正有歧义的 chunk** 上生成（而不是全量）
4. **更大规模的评测集**：当前 21 道题的分辨率不足以支撑小幅度结论

---

## 七、踩坑记录

1. **推理模型的 `max_tokens` 包含 reasoning tokens**。`deepseek-v4-flash` 一次调用会消耗 70–100 个 reasoning token；最初设 200 时，并发下推理吃光预算 → 空输出或半句截断。最终用 800，并在 `finish_reason=length` 时直接报错，避免写入半句 blurb。
2. **`content_tokens` 的改动是立即生效的**。它被 `content_tsv`（生成列）消费，而全文检索直接读 `content_tsv`。实验期间系统处于「旧向量 + 新分词」的混合状态，回退必须显式执行 `--stage=tokens --without-blurb`。
3. **文档级指标会掩盖 chunk 级退化**。如果只看「目标文档有没有进 top-5」，Contextual BM25 的负收益完全看不出来。

---

## 八、重实现要点（实施方案已随回退删除，此处保留关键参数）

将来重新验证时不必从零设计，按以下几点重建即可：

**生成器（`server/service/rag/contextualizer.ts`）**

- 裸 `fetch` 调 `${baseUrl}/chat/completions`，config 由调用方传入（零 Nitro 依赖，tsx 脚本可直接用）
- `temperature: 0`、`stream: false`、`max_tokens: 800`（推理模型的 reasoning tokens 计入该预算）
- prompt 要点：整篇文档 + 当前 chunk + 标题路径；要求 **1~2 句、≤100 字**；消解指代；**不复述原文**；不写「无指代」这类元说明
- 输出清洗：去围栏/引号、压空白；超 200 字在句末截断；`finish_reason=length` 直接报错，避免写入半句

**回填脚本（`scripts/backfill-contextual.ts`）**

- 三个阶段：`text`（生成）/ `embed`（重算向量）/ `tokens`（重算分词）
- `text` 阶段以 `contextual_text IS NULL` 为游标，幂等可续跑
- **外层循环文档、内层循环 chunk**（命中前缀缓存）；并发 3；失败行保持 NULL 等下次重试

**数据落点**

- 生成结果写 `chunks.contextual_text`（列已存在，阶段 A 预留）
- 向量 = `embed(contextual_text + "\n" + content)`，**原地 UPDATE**，保留 chunkId → 引用不失效
- 分词 = `toIndexedText(contextual_text + "\n" + content)`；`content_tsv` 由生成列自动跟随
- **`content` 永不改写**

**A/B 方法**

- 临时列 `embedding_ctx vector(1024)`，只加本地，实验后 `DROP`
- `retriever.ts` 加受控选项 `embeddingColumn?: 'embedding' | 'embedding_ctx'`，默认 `embedding`
- 对比用 [eval-retrieval.ts](../../scripts/eval-retrieval.ts) 的 chunk 级断言

---

## 相关文档

- [RAG 阶段 C 实施规划](2026-09-14-rag-stage-c-plan.md) — 3.9 / 3.10 / 3.11 的排序与依据
- [RAG 知识库完整设计](2026-08-19-rag-knowledge-base-design.md) — 决策 4 的原始目标
- [混合检索：向量 / 全文 / RRF](../learning-notes/hybrid-retrieval.md) — 3.9 的算法原理
- [引用溯源落地记录](2026-09-17-citation-implementation.md) · [ADR-015](../decisions/015-citation-metadata-carrier.md)
- Anthropic [Introducing Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval)（2024-09）— 原始方法与本语料的适用性差异
