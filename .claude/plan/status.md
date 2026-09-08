# 项目进度快照

> 更新于 2026-09-08

## 当前状态

**Phase 3 = RAG 知识库** — 阶段 A ✅（12 问召回 92%）；阶段 B 约 80%：M0 / M1 / M2 前半（3.6 UI）/ M3（3.8 图片端到端）✅，剩 **M2 后半（聊天选库器）** + M4（3.7 GitHub 引入）。

## 近期完成

- 3.8/M3 图片端到端验收通过（2026-09-08）— 对话检索命中正常返回、渲染白名单内图片；注入 URL 拒绝链路随 09-03 代码就位
- 3.6 知识库管理 UI（2026-09-06）+ 09-07 样式统一 refactor（Prompts/RAG 双页对齐）
- 3.5 上传 API + KB CRUD + ingest service（2026-09-03）｜ 3.1-3.4 检索管道/灌库/Agentic 闭环（2026-08-31）

## 下一步

1. **[P0] 聊天选库器（M2 后半）** — /api/chat body + ChatBodySchema 加 kbId，defaultKbId 注入 Agent 执行层（rag.store 已备 kbOptions）
2. **[P1] 3.7 GitHub 文档引入（M4）** — 浏览器编排逐条上传；相对图片路径改写为绝对 raw URL
3. **[P2] 阶段 C 质量增强（3.9-3.11）** — 混合检索 / Contextual Retrieval / 引用溯源

## 阻塞 / 风险

- 当前无阻塞项
- 提醒：todo「API 单元测试」推迟条件已满足（Agent/检索逻辑就位）；「PromptSegment 抽象」Phase 4 MCP 落地时必做

## 推迟项

- 文档在线编辑、公共组件抽取（候选见 [复用记录](/docs/dev-log/2026-09-06-rag-ui-component-reuse.md)）；todo.md 中 10 项待办，详见 [todo.md](todo.md)
