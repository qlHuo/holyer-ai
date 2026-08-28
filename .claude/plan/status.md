# 项目进度快照

> 更新于 2026-08-26

## 当前状态

**Phase 2 已完成 ✅**（2026-08-18）— 下一步 **Phase 3 = RAG 知识库**（2026-08-25 与 MCP 对调，MCP 顺延 Phase 4）。RAG 方案已定稿，待启动阶段 A 实施。

## 近期完成

- RAG 决策 7 图片处理 — 只存元数据 + 按次白名单渲染，顺带堵住既有外链缺口（2026-08-26）
- RAG 知识库完整设计 — 六决策 + Schema + 三阶段实施路径（2026-08-25）
- Phase 2 全链路审查 — 8 层梳理 + 7 项修复（2026-08-19）
- Prompt 评测-调优闭环 — 命中率 80%→100%（2026-08-18）
- AbortSignal 传递至工具执行层（2026-08-17）

## 下一步

1. **[P0] 3.1 Schema + pgvector** — 三张表 + 四个预留列（`user_id`/`embedding_model`/`source_type`/`images`），Neon 启用 pgvector
2. **[P0] 3.2 检索管道 Service** — chunker（Markdown 按标题）+ embeddings（qwen3.7，1024 维）+ retriever（纯向量）
3. **[P0] 3.3 灌库脚本** — `scripts/ingest-docs.ts` 读 /docs 58 篇灌库
4. **[P0] 3.4 检索工具 + 质量验证** — `search_knowledge_base` 注册进 ToolRegistry，10 问召回 >80% 才进阶段 B

> PromptSegment 抽象已从下一步移除：RAG 设计定为 MVP 暂硬编码，触发点顺延到 MCP 注入工具描述时。

## 阻塞 / 风险

- 检索质量不达标是 RAG 最大风险 — 缓解：阶段 A 脚本先验证，不达标先调分块/检索策略，达标才投 UI
- Embeddings 维度需在阶段 A 一次敲定（qwen3.7 / 1024 维），定错要重建全库
- 遗留：`server/service/llm/deepseek.ts` 是 provider 收敛后的废弃学习代码，无任何引用，可择机删

## 推迟项

todo.md 中有 9 项待办，详见 [todo.md](todo.md)
