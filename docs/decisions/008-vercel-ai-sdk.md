# ADR-008: Vercel AI SDK — 不集成，自建 Provider 抽象层

> 日期：2026-05-31 · 状态：✅ 已采纳

---

## 背景

项目初期评估是否应集成 Vercel AI SDK（`ai` + `@ai-sdk/openai` + `@ai-sdk/anthropic` + `@ai-sdk/vue`）来加速 Phase 1 开发。SDK 覆盖的功能与本项目 `server/service/llm/`、`server/service/agent/`、`app/composables/useChat.ts` 高度重叠。

同时，本项目的核心目标之一是"**通过该项目实现从前端开发向 AI Agent 开发的转型**"——手写核心模块本身就是学习目标，不能为了省时间而跳过理解过程。

## 决策

**Phase 1-2 不集成 Vercel AI SDK**，全部自建。Phase 3+ 可重新评估——那时已完成 Provider、Agent、Skills 的手写，有能力判断 SDK 到底替代了什么、值不值得。

## Vercel AI SDK 覆盖范围

```
Vercel AI SDK 能力                     本项目对应模块
─────────────────────────────────     ──────────────────────
@ai-sdk/openai / @ai-sdk/anthropic    server/service/llm/ (Provider 层)
统一 Provider 接口 + 流式输出         LLMProvider 接口

ai (core) — generateText/streamText   server/service/agent/ (Agent 层)
工具调用 + 结构化输出                 ReAct 循环 + 内置工具

@ai-sdk/vue — useChat composable      app/composables/useChat.ts
SSE 客户端 + 消息状态管理              SSE 消费 + 消息状态

@ai-sdk/nuxt — Nuxt 4 集成            无需自建
```

## SDK 覆盖不到的部分

SDK 管不了本项目的差异化核心：

| 模块 | 为什么 SDK 不能替代 |
|------|-------------------|
| Skills 系统 | Skill 的 Markdown 解析 + prompt 注入机制，SDK 不提供 |
| MCP 协议客户端 | MCP 的 HTTP/SSE 协议握手、JSON-RPC 格式，SDK 没有 MCP 支持 |
| RAG 管道 | 文档分块策略、pgvector 检索、Embeddings 批处理 |
| 垂直场景插件 | 场景模板系统、自定义 UI 挂载 |

**结论**：SDK 是底层胶水，不提供项目差异化价值。但自建完成后，Provider 适配和流式消费这些胶水代码本身也是学习目标。

## 关键理由

1. **学习路径不可跳过**：手写 OpenAI/Anthropic/DeepSeek 三个 Provider 的流式适配，是理解 LLM API 协议的最佳途径。跳过这一步等于在核心技能上留白
2. **先造轮子才能理解好轮子**（与 LangChain.js 评估结论一致）：手写完 ReAct 循环后，对 SDK 的 `generateText` + `maxSteps` 不再是黑盒；那时再评估 SDK 才有资格做取舍
3. **工作量可控**：两个适配器（OpenAI 格式 + Anthropic 格式）约 200 行代码，~5 小时工作量，不是重复造大轮子
4. **国内模型几乎全部 OpenAI 兼容**：换 `baseURL` + `apiKey` 即接入新模型，OpenAI 适配器覆盖 90% 以上的国内模型（详见 [ADR-009](009-model-compatibility.md)）

## 自建模块的实际覆盖

```
你的代码                           覆盖的模型
─────────────────────────────────────────────
openai.ts (OpenAI 格式适配器)      OpenAI、DeepSeek、千问、GLM、
                                    Kimi、MiniMax、豆包、百川 …
anthropic.ts (Anthropic 格式适配器) Claude 全系
factory.ts (注册表)                 一行配置接入新模型
```

## 替代方案（暂不采纳）

- **现在就用 Vercel AI SDK**：开发快，但跳过了理解 LLM 协议的核心学习过程，与项目转型目标冲突
- **Phase 3+ 引入 SDK 替换 Provider 层**：那时已充分理解底层，有能力判断 SDK 的长期价值

## 代价

- Phase 1 开发时间增加约 5 小时（手写 Provider 适配器 + SSE 工具）
- 需要自行适配 Anthropic 与 OpenAI 的 SSE 格式差异（但这是学习目标本身）

---

## 相关文档

- [ADR-009: 国内模型 API 兼容性调研与统一策略](009-model-compatibility.md)
- [2026-05-31 流式架构深层讨论](../dev-log/2026-05-31-streaming-architecture.md)
- [2026-05-31 LangChain.js 评估](../dev-log/2026-05-31-discussion.md) — 同样的"先自建再评估"策略
