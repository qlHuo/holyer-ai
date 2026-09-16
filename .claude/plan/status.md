# 项目进度快照

> 更新于 2026-09-16

## 当前状态

**Phase 3 = RAG 知识库** — 阶段 A ✅ / 阶段 B ✅ 收官（2026-09-09）；**阶段 C 进行中**：3.9 混合检索 ✅ **本地 + 线上全量落地**，剩 **3.11 引用溯源 → 3.10 Contextual Retrieval**。

## 近期完成

- 3.9 混合检索**完整落地**（2026-09-16）— 本地：retriever 拆 `searchByVector`/`searchByKeyword`/`hybridSearch`(RRF) + `tokenizer.ts` + `content_tokens`/生成列 `content_tsv`/GIN + 回填脚本；线上：建列 → 回填 → 补账本 → 部署。**concept 92% 持平、exact MRR 0.926→1.000**
- 顺手还清数据库欠账：线上/本地迁移账本（`drizzle.__drizzle_migrations`）从空补齐，以后 `generate`→`migrate` 可正常用（详见 [drizzle-kit 笔记](docs/learning-notes/drizzle-kit.md)）
- 3.7 GitHub 文档引入（M4，2026-09-09）— 阶段 B 收官｜ M2 后半·聊天选库器（2026-09-09）
- 3.8/M3 图片端到端验收（2026-09-08）｜ 3.6 知识库管理 UI（2026-09-06）
- 3.5 上传 API + KB CRUD（2026-09-03）｜ 3.1-3.4 检索管道/灌库/Agentic 闭环（2026-08-31）

## 下一步

1. **[P0] 3.11 引用溯源** — `heading_path`/`source_url` + citation 渲染与白名单（详见 [实施规划](docs/dev-log/2026-09-14-rag-stage-c-plan.md)）
2. **[P1] 3.10 Contextual Retrieval** — 需全量重算 embedding，压最后
3. **[P1] Phase 4 MCP** — 开工先落 PromptSegment 抽象

## 阻塞 / 风险

- 当前无阻塞项
- ✅ `Intl.Segmenter` 在 CF Workers 可用（线上已验证，此前唯一未证实假设已排除）
- ⏳ 待观察：分词 CPU 开销（实测 Node 上 1.89 KB/ms）—— 线上暂未触发限额，大文档上传时可留意 Dashboard CPU Time

## 推迟项

- 3.9 已知取舍：混合检索 top-5 会被「两路都靠前」的 chunk 占满，纯关键词独中的 chunk 可能被挤出（可调 `candidates`/`topK`）
- 文档在线编辑、公共组件抽取等；todo.md 中 11 项待办，详见 [todo.md](todo.md)
