# 项目进度快照

> 更新于 2026-07-23

## 当前状态

**Phase 2 设计阶段完成** — 实现待启动，完成度约 0%

## 近期完成

- [设计] Phase 2 Agent 系统完整方案（6 个架构决策 + 10 个实现步骤）
- [ADR-012] `chat()` 返回类型升级为 `ReadableStream<LLMStreamChunk>`（2026-07-21）
- [ADR-013] Prompt 统一命名 + Phase 2 第一步实现顺序确定（2026-07-23）
- [ADR-014] Agent 流式 DB 一次性写入策略（2026-07-21）
- [设计] Provider 层精简：删除 Anthropic，DeepSeek 复用 OpenAIProvider

## 下一步（按优先级）

1. **[P0] Prompt CRUD** — DB Schema（`prompts` 表）→ Service → 5 个 REST API，零依赖，独立交付
2. **[P0] 共享类型扩展** — `LLMStreamChunk`、`ToolCall`、`ToolDefinition`，Phase 2 所有模块的基石
3. **[P1] 工具系统** — ToolRegistry + 2 个内置工具（calculator、current-time），可离线验证
4. **[P1] Provider 升级** — `openai.ts` tool call delta 累积 + 删除 `anthropic.ts`
5. **[P1] Agent Runtime** — ReAct 循环 + `/api/agent/run` 端点

## 怎样开始（Prompt CRUD 三步走）

1. **创建 DB Schema**（`server/db/schema.ts` 新增 `prompts` 表 → `drizzle-kit push`）
2. **编写 Service 层**（`server/service/prompts/` → types + CRUD 方法）
3. **创建 5 个 API 端点**（`server/api/prompts/` → GET/POST index + GET/PUT/DELETE [id]）

> 预计 2 小时，curl 验证。DB + API 模式已在 Phase 1 充分验证，无意外风险。
> 详细步骤参考 [phase2-agent-design.md](phase2-agent-design.md) 第 12.4 节步骤 1。

## 阻塞 / 风险

- 删除 Anthropic Provider 后短期无法使用 Claude 模型（已知取舍，git 历史保留原实现）
- 当前无紧急阻塞项

## 推迟项

todo.md 中有 7 项待办，详见 [todo.md](todo.md)
