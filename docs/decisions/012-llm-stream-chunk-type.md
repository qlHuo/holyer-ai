# ADR-012: `chat()` 返回类型统一升级为 `ReadableStream<LLMStreamChunk>`

> 日期：2026-07-21 · 状态：✅ 已采纳

---

## 背景

Phase 1 中 `LLMProvider.chat()` 返回 `ReadableStream<string>`，每个 chunk 只是一段文本。Phase 2 引入 Agent Runtime 后，LLM 响应需要同时承载两种信息：

- **文本增量**（流式逐字输出）
- **工具调用**（可能跨多个 chunk 累积后一次性发出）

## 决策

**将 `chat()` 返回类型从 `ReadableStream<string>` 统一升级为 `ReadableStream<LLMStreamChunk>`。**

不新增第二个方法（如 `chatWithTools()`），所有 Provider 统一使用新的流类型。

## 对比

| 维度 | 单方法升级（采纳） | 双方法（否决） |
|------|:---:|:---:|
| 接口复杂度 | 1 个方法，语义清晰 | 2 个方法，调用方需判断 |
| `/api/chat` 改动量 | ~5 行过滤 `chunk.type` | 不需要改 |
| Provider 实现改动 | 3 个 Provider 需适配 | 只需新增方法 |
| 调用方心智负担 | 低（一个流，两种事件） | 高（何时用哪个？） |

## 关键理由

1. **避免接口膨胀**：`LLMProvider` 保持单一 `chat()` 方法，所有 LLM 交互走同一个入口
2. **`/api/chat` 改动极小**：只需加 `if (chunk.type === 'text')` 过滤，忽略 `tool_calls` 和 `done`
3. **Agent Runtime 天然适配**：同一个流读取循环即可处理 text 和 tool_calls 两种事件

## 代价

- 需要改动 Provider 实现 + `/api/chat`（原估算为 OpenAI、Anthropic、DeepSeek 三个 Provider，后续 Phase 2 设计决定删除 Anthropic、DeepSeek 复用 OpenAIProvider，实际改动收敛为一个 Provider 实现类）
- 改动量可控：Provider ~30-40 行（tool call delta 累积），`/api/chat` ~5 行

## 技术注记

`LLMStreamChunk` 的 `done` 类型表示本轮 LLM 调用的**语义结束**（区别于 `ReadableStream` 的机械 `{ done: true }` 信号）。Runtime 层通过 `done` chunk 区分"流正常结束"和"连接意外中断"。Provider 层统一在 `controller.close()` 前 emit `done`。

## 与 OpenAI SDK 的关系

Phase 2 决定使用 OpenAI SDK（不再手写 HTTP/SSE 解析）。SDK 的 `stream()` 返回 `Stream<OpenAI.Chat.Completions.ChatCompletionChunk>`，每个 chunk 携带 `choices[0].delta`。Provider 层（`openai.ts`）负责：

```
OpenAI SDK 原生 chunk（SDK 类型）
    │
    ▼  Provider 内部转换
LLMStreamChunk（项目统一类型）
    │
    ▼  消费方（/api/chat、Agent Runtime）
```

`LLMStreamChunk` 是项目内部的统一抽象，不直接暴露 SDK 类型。这样做的原因：
- **消费方不感知 SDK**：`/api/chat` 和 Agent Runtime 只依赖 `shared/types/provider.ts`，不 import `openai`
- **未来可换实现**：如果将来需要换 SDK 或回退到手写 fetch，消费方代码不受影响
- **薄封装层**：转换逻辑极简（`delta.content → { type: 'text', content }`），不增加实质复杂度

## 相关文档

- [ADR-013：统一命名为 Prompt](013-prompt-naming.md)
- [ADR-014：Agent 流式 DB 写入策略](014-agent-streaming-db-write.md)
- [Phase 2 Agent 系统设计方案](../../.claude/plan/phase2-agent-design.md)（含实现步骤）
- [ADR-008：Vercel AI SDK 不集成](008-vercel-ai-sdk.md)
