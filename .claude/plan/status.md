# 项目进度快照

> 更新于 2026-09-15

## 当前状态

**Phase 3 = RAG 知识库** — 阶段 A ✅ / 阶段 B ✅ 收官（2026-09-09）；**阶段 C 进行中**：3.9 混合检索 ✅（2026-09-15，本地），剩 **3.11 引用溯源 → 3.10 Contextual Retrieval**。

## 近期完成

- 3.9 混合检索（2026-09-15）— retriever 拆为 `searchByVector`/`searchByKeyword`/`hybridSearch`（RRF）、`tokenizer.ts` 分词、`content_tokens`+生成列+GIN、回填脚本。**concept 92% 持平、exact MRR 0.926→1.000**
- 3.7 GitHub 文档引入（M4，2026-09-09）— 浏览器编排、覆盖/跳过、相对图转绝对 raw URL；阶段 B 收官
- M2 后半·聊天知识库选择器（2026-09-09）｜ 3.8/M3 图片端到端验收（2026-09-08）
- 3.6 知识库管理 UI（2026-09-06）+ 09-07 样式统一 refactor
- 3.5 上传 API + KB CRUD + ingest service（2026-09-03）｜ 3.1-3.4 检索管道/灌库/Agentic 闭环（2026-08-31）

## 下一步

1. **[P0] 3.9 线上落地（你手动）** — 线上执行 `0002_*.sql` → 跑 `scripts/backfill-tokens.ts` → 部署；注意 ledger pre-flight 与 CF `Intl.Segmenter` 真机 probe
2. **[P0] 3.11 引用溯源** — `heading_path`/`source_url` + citation 渲染与白名单（详见 [实施规划](docs/dev-log/2026-09-14-rag-stage-c-plan.md)）
3. **[P1] 3.10 Contextual Retrieval** → 其后 **[P1] Phase 4 MCP**（开工先落 PromptSegment 抽象）

## 阻塞 / 风险

- 当前无阻塞项
- 3.9 的**唯一未证实假设**：CF Workers 的 ICU 是否含 `zh` 分词数据（本地 Node 已验证可用，线上待真机 probe）
- 提醒：todo「API 单元测试」推迟条件已满足；「后台流中途切回残留」已推迟 30+ 天且近期 runner/工具流有变更，可考虑重估

## 推迟项

- 3.9 已知取舍：混合检索 top-5 会被「两路都靠前」的 chunk 占满，纯关键词独中的 chunk 可能被挤出（可调 `candidates`/`topK`）
- 文档在线编辑、公共组件抽取等；todo.md 中 11 项待办，详见 [todo.md](todo.md)
