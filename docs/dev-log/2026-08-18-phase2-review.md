# 2026-08-18 — Phase 2 全链路审查与收尾修复

> Agent 系统 8 层链路逐层梳理 + 7 项问题分级定位 + 本轮修复 7 项（架构 2 项 + 代码质量 5 项）+ 1 项推迟。结论：链路正确性经得起推敲，无生产故障级 bug。

---

## 讨论背景

Phase 2 收尾优化（工具结果持久化、文本闪烁、内容审核自愈、Prompt 调优、Memory 裁剪）全部完成后，对 Agent 系统做一次全链路审查，确认「声明 → 执行 → 落库 → 渲染」四段闭环是否自洽，并清理审查中发现的死代码、安全盲区与代码异味。

---

## 核心内容

### 1. 全链路梳理（8 层）

```
前端                                    后端
─────────────────────────────────────────────────────────
useChat (SSE 消费/多路流/切换恢复)  →  /api/chat (index.post.ts)
chat.store (消息态 + agentToolCalls)      │ Zod 校验 → 拼 system prompt
buildRenderItems (DB 消息折叠)            │ (dateContext + toolUsageGuidelines)
ChatPanel → MessageBody →                 │
  AgentToolInline / ToolCallCard           ▼
                                     runAgentLoop (runner.ts)
                                       ReAct 循环 / 内容审核自愈 /
                                       前瞻窗口 / 工具并发+缓存
                                       │
                                     AgentMemory (trim 裁剪)
                                       │
                                     ToolRegistry → 4 工具
                                       │
                                     OpenAIProvider (chat → LLMStreamChunk)
```

链路本身闭合自洽：工具调用「声明 → 执行 → 落库 → 渲染」四段都能对上，`tool_call_id` 关联贯穿后端落库与前端折叠，`persistAgentToolCalls` 在流结束收口点把双轨合流。

### 2. 发现的问题（分级）

| 级别 | # | 问题 | 处理 |
|:--:|---|------|------|
| 🟡 架构 | 1 | 纯聊天路径是死代码 + 所有请求付 1s 前瞻成本 | 删 else 分支 |
| 🟡 架构 | 2 | `web_fetch` SSRF 盲区（无内网拦截） | 加 `isPrivateHostname` |
| 🟡 边界 | 3 | 达 maxIterations 上限无最终回复（刷新见空） | error 落库 |
| 🟡 边界 | 4 | 后台流中途切回，工具卡片状态/文本不准 | 记 todo（双轨统一风险高） |
| ⚪ | 5 | tool call `name` 用 `+=` 累积（兼容模型重复发送会拼接） | 改覆盖式 |
| ⚪ | 6 | Provider `done` chunk 无消费者 | 删除 |
| ⚪ | 7 | `calculator` 用 `new Function`（白名单是唯一边界） | 加安全注释 |
| ⚪ | 8 | `tavilyApiKey` 用 `as any` 逃逸类型 | 直用 `config.tavilyApiKey` |
| ⚪ | 9 | 注释过时（schema role、llm/types JSDoc） | 同步 |

### 3. 本轮修复明细

**#1 纯聊天死代码**（[index.post.ts](../../server/api/chat/index.post.ts)）：工具在 `tools/index.ts` 无条件注册，`toolDefinitions.length > 0` 恒真，else 纯聊天分支永远走不到。删除 else 分支 + `filterTextChunks` import，保留 if 判断作为「零工具模式」扩展点。注意：这是 07-30「无 Agent 开关」架构决策的副作用——纯闲聊也因此走 Agent 循环、付约 1s 前瞻窗口成本，是既定代价。

**#2 SSRF 防护**（[web-fetch.ts](../../server/service/agent/tools/builtin/web-fetch.ts)）：新增 `isPrivateHostname()` 拦截内网/保留地址（`localhost`、`127/8`、`10/8`、`172.16/12`、`192.168/16`、`169.254/16`、IPv6 环回、内网 TLD）。边界：Edge 无 `dns` 模块只能拦字面量 IP，防不了 DNS rebinding，但对个人应用足够。

**#3 error 落库**（[index.post.ts](../../server/api/chat/index.post.ts)）：error 事件且 `finalMsgId` 为 null 时（maxIterations 上限 / Agent 超时），落一条 assistant 消息记录错误文案，避免刷新后只看到工具消息无最终回复。

**#5 name 覆盖式**（[openai.ts](../../server/service/llm/openai.ts)）：tool call delta 的 `name` 从 `+=` 改 `=`，与 `id` 一致。`name` 不分片（只有 `arguments` 分片），覆盖式能防御兼容模型每个 delta 重复发完整 name 导致的重复拼接。

**#6 done chunk 删除**（[openai.ts](../../server/service/llm/openai.ts) + [provider.ts](../../shared/types/provider.ts)）：`done` chunk 从无消费者（Runner 与 `filterTextChunks` 都靠 `reader.read()` 的 `done:true` 结束），删除 enqueue + `LLMStreamDoneChunk` 类型，流结束由 `close()` 隐式表示。

**#8 类型逃逸**（[web-search.ts](../../server/service/agent/tools/builtin/web-search.ts)）：`(config as any).tavilyApiKey` 改为 `config.tavilyApiKey`（runtimeConfig 已声明该字段）。

**#9 注释同步**（[schema.ts](../../server/db/schema.ts) + [llm/types.ts](../../server/service/llm/types.ts)）：`messages.role` 注释补 `tool`；`LLMProvider.chat()` JSDoc 从 `ReadableStream<string>` 同步为 `LLMStreamChunk`（ADR-012 升级后遗留）。

**#7 calculator 注释**（[calculator.ts](../../server/service/agent/tools/builtin/calculator.ts)）：`SAFE_EXPR_RE` 白名单加注释，明确「白名单是唯一安全边界，放宽 = 任意代码执行」。

### 4. 推迟项

**#4 后台流中途切回残留** — 切换回「工具执行中」的对话时，工具卡片以 done 态渲染（实际仍 running），最终文本可能不写入 messages。根因是 `agentToolCalls` 实时态与 DB `messages` 双轨在切回时未合流，需「阶段 2 完整版」双轨统一，风险高。已记入 [todo.md](../../.claude/plan/todo.md)。

---

## 关键洞察

- **死代码是架构决策的诚实印记**：「纯聊天路径」的死亡不是疏忽，而是 07-30「无 Agent 开关」决策的必然结果。删它之前要先确认它确实被决策「排除」，而不是被遗忘——本轮通过注释保留了「零工具模式」的扩展点。
- **安全护栏要覆盖「读哪里」而非只「读不读」**：工具权限分级（readonly/readwrite/dangerous）只约束「能不能读写」，不约束「读写谁」。SSRF 属于后者，是权限分级盲区。
- **审查的价值在「分级」而非「列清单」**：7 项问题里真正值得立即动手的只有架构 2 项 + 边界 1 项，其余是「下次碰对应模块顺手修」的级别。列清单不加分级，容易诱发「为修而修」的过度工程。

## 相关文档

- [2026-08-06 Agent ReAct 已知问题](2026-08-06-agent-react-known-issues.md) — 工具持久化/文本闪烁/内容审核/Memory 裁剪的原始问题记录
- [2026-08-05 Agent ReAct 完整流程](2026-08-05-agent-react-full-flow.md) — 6 层架构数据流追踪
- [2026-08-17 Prompt 评测-调优闭环](2026-08-17-prompt-eval-tuning-loop.md) — 前序收尾（Prompt 调优）
- [ADR-012 LLMStreamChunk](../decisions/012-llm-stream-chunk-type.md) — `chat()` 返回类型升级（本轮 #6 删除了其中的 done 变体）
- [ADR-014 Agent 流式 DB 写入](../decisions/014-agent-streaming-db-write.md) — 工具消息落库格式
