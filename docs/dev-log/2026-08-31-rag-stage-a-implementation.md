# 2026-08-31 — RAG 阶段 A 落地：从管道验证到 Agentic 检索闭环

> 核心洞察：RAG 的难点 80% 在检索质量。阶段 A 用「纯脚本 + 评估集」先把最不确定的检索跑通验证（12 问召回 92%），达标才投入 UI——避免了"界面做完发现检索是垃圾"的返工。

---

## 讨论背景

RAG 设计定稿于 08-19（见 [设计文档](2026-08-19-rag-knowledge-base-design.md)），阶段 A 目标是**纯后端脚本验证检索质量**，召回命中率 >80% 才做 UI。本文记录实际落地过程与踩坑。

## 落地过程（6 步）

1. **前置验证**：embedding 维度实测 1024（[embedding-dimensions](../learning-notes/embedding-dimensions.md)）、drizzle 0.45.2 支持 `vector` 类型、本地 pgvector 环境 → 迁 Docker（[local-db-docker-migration](2026-08-30-local-db-docker-migration.md)）
2. **Schema**：3 张表 + 4 预留列（[rag-schema](../learning-notes/rag-schema.md)）
3. **Service 三层**：chunker（语义分块）/ embeddings（qwen3.7）/ retriever（纯向量检索）——全部纯函数、零 Nitro 依赖
4. **灌库脚本**：读 `docs/` + `.claude/plan/` 的 markdown → 分块 → 批量向量化 → 存库
5. **召回验证**：12 问评估集，命中率 **92%**（>80% 达标）
6. **search_knowledge_base 工具**：注册进 ToolRegistry，Agentic RAG 闭环

## 关键踩坑

### 1. 双驱动 union 泄漏 —— `db.execute` 返回类型不一致

`server/db/index.ts` 用 `import.meta.dev` 分支双驱动，导致 `db` 是联合类型，`db.execute()` 的返回类型也泄漏成 union：

- postgres-js（本地）→ 直接返回行数组
- neon-http（生产）→ 返回 `{ rows }`

类型化 API（`db.select()`）有"驱动适配器"统一形状，但裸 `sql` 模板（retriever 用它写 pgvector 距离）绕过适配器，把原生形状露出来。解法：`('rows' in result ? result.rows : result)` 归一化。

### 2. `scripts/` 不在 tsconfig 范围

Nuxt 的 tsconfig 只覆盖 app/server/shared，`scripts/` 不在其中，且 `.nuxt/tsconfig.node.json` 有 `types: []` 屏蔽全局类型。所以脚本里 `process`/`console` 报"找不到名称"。解法（与 `drizzle.config.ts` 同款）：文件头加 `/// <reference types="node" />`。跑 TS 脚本还需 `tsx`（Node 不认 .ts）。

### 3. `process.exit` 不收窄类型，`throw` 才收窄

校验环境变量时 `if (!x) process.exit(1)` 之后，TS 仍认为 `x` 是 `string | undefined`——`process.exit` 在类型层面不是"永不返回"。改成 `throw` 的 `requireEnv()` 辅助函数后，类型正确收窄。

### 4. 综合题「整体流程」召回差 —— 阶段 C 的伏笔

12 问里唯一 miss 的是「说明项目整体流程」（跨文件综合题）。根因：纯向量检索对宽泛的综合查询力不从心，这正是阶段 C 混合检索 + Contextual Retrieval 要解决的。此题为已知难例留档。

## 关键洞察

- **评估集驱动**是阶段 A 的核心方法论：先用 12 问规则判定召回（无 LLM 裁判，复用 Prompt 评测思路），达标才投入 UI
- **纯函数 service 分层**（chunker/embeddings/retriever 零 Nitro 依赖）让同一套逻辑同时服务 tsx 脚本和运行时工具，是"灌库脚本 vs 上传 API"复用的关键
- **标题进 content**（决策 1）让 chunk 自包含、提升召回；图片 URL 进元数据列（决策 7）不污染向量

## 相关文档

- [RAG 知识库完整设计](2026-08-19-rag-knowledge-base-design.md) — 阶段 A 的设计依据
- [rag-schema](../learning-notes/rag-schema.md) — 三表结构
- [embedding-dimensions](../learning-notes/embedding-dimensions.md) — 维度锁定
- [pgvector](../learning-notes/pgvector.md) — 向量检索原理
- [local-db-docker-migration](2026-08-30-local-db-docker-migration.md) — 本地库迁移
- [agent-tool-budget](2026-08-31-agent-tool-budget.md) — Agentic 实测暴露的资源预算问题
