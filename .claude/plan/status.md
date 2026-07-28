# 项目进度快照

> 更新于 2026-07-26

## 当前状态

**Phase 2 进行中** — 第一步（提示词管理）✅，第二步（Agent Runtime）待启动，整体完成度约 19%

## 近期完成

- [2.0] 自定义提示词管理 — DB + Service + 6 API + 前端管理页（2026-07-26）
- [2.3] Provider 精简 — 删除 Anthropic、DeepSeek 复用 OpenAIProvider、provider 维度全链路移除，21 文件净删 259 行（2026-07-26）
- [设计] Phase 2 完整方案定稿 + ADR-012/013/014（2026-07-21~23）

## 下一步（按优先级）

1. **[P0] Provider 升级** — `chat()` → `ReadableStream<LLMStreamChunk>` + tool call delta 累积
2. **[P1] Agent Runtime** — ReAct 循环 + `/api/agent/run` 端点 + Prompt 注入管线
3. **[P1] 内置工具** — ToolRegistry + calculator / current-time / search
4. **[P2] Agent UI** — 工具调用可视化（ToolCallCard）、推理过程展示
5. **[P2] 安全护栏 + 可观测性** — 工具权限分级、ReAct 循环追踪、Token 统计

## 阻塞 / 风险

- 当前无紧急阻塞项
- Cloudflare Edge Runtime 限制：WebSocket 不可用，MCP 仅 HTTP/SSE 传输

## 推迟项

todo.md 中有 7 项待办，详见 [todo.md](todo.md)
