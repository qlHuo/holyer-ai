# 项目进度快照

> 更新于 2026-08-03

## 当前状态

**Phase 2 第二步完成** — Agent Runtime 核心完成，完成度约 85%

## 近期完成

- [2.1] Runner 重写 — AsyncGenerator + AgentMemory + 并发执行（2026-08-03）
- [2.2] 工具扩展 — web_search + web_fetch（2026-08-03）
- [2.4] `/api/chat` 适配 — Agent SSE 事件 + DB 写入策略（2026-08-03）
- [2.5] Agent UI — ToolCallCard + useChat + store（2026-08-03）
- [2.6] 代码卫生 — 清理 console.log + 死代码 + schema tools 字段（2026-08-03）

## 下一步

1. **[P1] 工具扩展** — date_calculator、unit_converter、text_stats、json_formatter（纯函数，零依赖）
2. **[P2] Prompt 工程** — 调优 System Prompt 引导 LLM 合理调用工具（当前 DeepSeek 对"你好"也调工具）
3. **[P2] 文本流式优化** — 最后一轮用 `tee()` 实现逐 token 流式输出（当前一次性发出）
4. **[P3] Prompt Segment 系统** — 代码中的 system prompt 片段管理
5. **[P3] Agent 持久化** — 工具调用结果写入 DB（当前仅 UI 瞬时展示）

## 阻塞 / 风险

- Brave Search API Key 未配置（web_search 工具降级返回提示）
- DeepSeek v4-pro 对工具调用过于激进（"你好"也会触发多轮工具调用），需通过 System Prompt 引导

## 推迟项

todo.md 中有 7 项待办，详见 [todo.md](todo.md)
