# ADR-014: Agent 流式 DB 写入策略

> 日期：2026-07-21 · 状态：✅ 已采纳（已知让步）

---

## 背景

`/api/chat` 中用了"每 200 字符增量 UPDATE"的策略，保证中途刷新不丢数据。但 Agent 的 ReAct 循环结构更复杂——多轮调用、工具调用穿插、文本输出分散在多轮中——流式增量写入难度显著大于普通聊天。

## 决策

**当前方案在 Agent 流完全结束后一次性写入最终内容。** 这是一个已知的让步。

## 对比

| 维度 | 一次性写入（采纳） | 增量写入（暂缓） |
|------|:---:|:---:|
| 实现复杂度 | 低 | 高（需重构 Runtime 接口） |
| 中途刷新安全性 | 丢失当前回复 | 不丢失 |
| 实际影响 | 低（ReAct 循环快，2-3 轮） | — |

## 与 Phase 1 增量策略的差异

Phase 1 的普通聊天使用"每 200 字符增量 UPDATE"策略——因为文本是线性增长的，只需要 `content += delta` 然后 UPDATE。Agent 场景无法直接复用此策略，原因有三：

1. **数据结构不同**：Agent 的消息不是单一的文本增量，而是多轮交织的文本 + 工具调用 + 工具结果。一轮 ReAct 循环可能产出 `[assistant(tool_calls)] → [tool(result)] → [assistant(text)]`，不能简单用字符数阈值触发 UPDATE
2. **写入粒度不同**：Phase 1 的增量 UPDATE 只更新一条 assistant 消息的 `content` 字段。Agent 场景每轮需要插入多条消息（assistant + tool），且消息间有外键关联（`toolCallId`）
3. **事务边界不同**：增量 UPDATE 是无状态的（每次只追加 content）。Agent 场景的写入需要保证一轮循环内的消息要么全写入、要么全不写入——中途刷新看到半轮循环的消息比看不到更糟糕（可能只有 tool_call 没有 tool result）

## 关键理由

1. **实现简单**：不需要修改 `runAgentLoop` 的接口，在 SSE 流结束后直接调用 `updateMessage`
2. **实际影响低**：Agent 的 ReAct 循环通常很快（2-3 轮），远短于长文本流式场景
3. **不阻塞交付**：这个优化不影响功能正确性，可以后续迭代

## 改进方向

1. 重构 `runAgentLoop` 接受一个回调/emitter 接口，让 API 层拦截文本事件做增量 DB 写入
2. 或者在 API 层包装 `controller`，拦截 `SSE_EVENT.TEXT` 事件做增量写入

## 当前影响

用户在 Agent 运行期间刷新页面会丢失该次 Agent 的完整回复。但由于 ReAct 循环本身较快（通常 2-3 轮），实际影响小于 Phase 1 中的长文本流式场景。

## Agent 消息 DB 存储格式

Agent 消息复用现有的 `messages` 表。该表已包含 `tool_calls`（jsonb）和 `tool_call_id`（varchar）字段，可完整承载 Agent 的消息结构：

```
一轮 ReAct 循环写入的消息：

messages 表行                        role          content        tool_calls            tool_call_id
──────────────────────────────────────────────────────────────────────────────────────────────────
LLM 返回 tool call →                "assistant"   ""             [{id:"call_1",         null
                                                                    name:"calculator",
                                                                    arguments:"..."}]
工具执行结果 →                      "tool"        "3995"         null                   "call_1"
LLM 返回纯文本 →                    "assistant"   "235 × 17 =    null                   null
                                                  3995..."
```

**关键规则**：
- `role='assistant'` + 非空 `tool_calls` → 该消息是 LLM 发起的工具调用
- `role='tool'` + 非空 `tool_call_id` → 该消息是工具执行结果，`tool_call_id` 关联到上条 assistant 消息的 `ToolCall.id`
- `role='assistant'` + 空 `tool_calls` → 该消息是 LLM 的纯文本回复（循环终止）

消息按 `created_at` 排序即为完整的对话时间线。前端渲染时按 role 选择组件：`assistant`（含 tool_calls）→ ToolCallCard，`tool` → 工具结果卡片，`assistant`（纯文本）→ ChatMessage。

## 相关文档

- [ADR-012：LLMStreamChunk 类型升级](012-llm-stream-chunk-type.md)
- [Phase 2 Agent 系统设计方案](../../.claude/plan/phase2-agent-design.md)（含实现步骤）
