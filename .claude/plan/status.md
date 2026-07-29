# 项目进度快照

> 更新于 2026-07-29

## 当前状态

**Phase 2 进行中** — 第二步 Agent Runtime 核心已跑通，完成度约 42%

## 近期完成

- [2.1] Agent ReAct 循环 + Tool Registry + tool call delta 累积（2026-07-29）
- [2.2] 内置工具 — calculator + current-time（2026-07-29）
- [2.3] Provider 升级 — chat() → `ReadableStream<LLMStreamChunk>` + Anthropic 删除（2026-07-29）
- [2.0] 自定义提示词管理（2026-07-26）
- [2.3] Provider 精简 — 全链路移除 provider 字段（2026-07-26）

## 下一步（按优先级）

1. **[P0] `/api/agent/run` 独立端点** — 当前 ReAct 复用 `/api/chat` 但 `filterTextChunks` 吃掉了所有工具调用事件，前端完全不可见
2. **[P0] Agent UI** — Agent 开关 + ToolCallCard + SSE 事件处理，让用户"看到"Agent 在干什么
3. **[P1] AgentMemory 上下文管理** — 消息裁剪策略，防止多轮工具调用消息数组无限增长
4. **[P2] 可观测性 + 安全护栏** — AgentLogger 日志 + 工具参数 sanitize + 权限分级执行
5. **[P2] Prompt Segment 系统** — buildPrompt() 拼装，为 Prompt 注入管线打基础

## 阻塞 / 风险

- 当前无阻塞项
- ReAct 循环已跑通（curl 可验证），但前端无入口——需尽快补齐 UI

## 推迟项

todo.md 中有 7 项待办，详见 [todo.md](todo.md)
