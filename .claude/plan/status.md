# 项目进度快照

> 更新于 2026-07-26

## 当前状态

**Phase 2 第一步完成** — 提示词管理已交付，完成度约 14%（1/7 任务）

## 近期完成

- [2.0] 自定义提示词管理 — DB Schema + Service + 6 个 REST API + 前端管理页（2026-07-26）
- [设计] Phase 2 完整方案定稿 + ADR-012/013/014（2026-07-21~23）
- [设计] Provider 层精简方案：删除 Anthropic，DeepSeek 复用 OpenAIProvider

## 下一步（按优先级）

1. **[P1] Provider 升级** — `chat()` → `ReadableStream<LLMStreamChunk>`、tool call delta 累积、精简 Anthropic/DeepSeek
2. **[P1] 工具系统** — ToolRegistry + 内置工具（calculator、current-time）
3. **[P1] Agent Runtime** — ReAct 循环 + `/api/agent/run` 端点 + Prompt 注入管线
4. **[P2] Agent UI** — 工具调用可视化（ToolCallCard）、推理过程展示
5. **[P2] 安全护栏 + 可观测性** — 工具权限分级、ReAct 循环追踪、Token 统计

## 阻塞 / 风险

- 删除 Anthropic Provider 后短期无法使用 Claude 模型（已知取舍，git 历史保留原实现）
- 当前无紧急阻塞项

## 推迟项

todo.md 中有 7 项待办，详见 [todo.md](todo.md)
