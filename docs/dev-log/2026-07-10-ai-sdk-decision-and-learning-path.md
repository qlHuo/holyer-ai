# 2026-07-10 — AI SDK 引入决策 + ReAct 循环学习路径

> 这是 Phase 2 启动前最重要的架构决策。核心矛盾：要不要引入 AI SDK 处理 Agent 工具调用？引入的话，ReAct 循环还能学到吗？

---

## 背景

Phase 1 手写了三个 Provider（OpenAI + Anthropic + DeepSeek），理解了 LLM API 协议和 SSE 流式格式。Phase 2 要引入工具调用和 ReAct 循环。

如果继续手写，意味着要在 `openai.ts` 和 `anthropic.ts` 中各实现工具调用的流式解析：
- OpenAI：`tool_calls[0].function.arguments` 分片 JSON delta，按 index 索引拼接
- Anthropic：`tool_use` content_block 累积 JSON 前缀，按 content_block index 追踪

这两者格式完全不同——**这是"记 API 文档细节"，不是"学 Agent 架构"**。

## 决策

**引入 AI SDK（`ai` + `@ai-sdk/openai` + `@ai-sdk/anthropic`），但分两阶段使用：**

| 阶段 | 做法 | 目的 |
|------|------|------|
| **4a（学习）** | `streamText({ maxSteps: 1 })`，循环自己写 | 亲手理解 ReAct 循环的消息增长、停止判断、上下文管理 |
| **4b（生产）** | `streamText({ stopWhen: stepCountIs(10) })` | 删除手写循环，切换到 SDK 托管 |

两个版本的 chunk → SSE 映射逻辑完全相同，切换只是一个 API 参数的变化。

## 为什么不是"全手写"

1. **Phase 2 的学习目标变了**。Phase 1 的学习目标是"LLM API 协议"——手写三个 Provider 是必要的。Phase 2 的学习目标是"Agent 架构"——ReAct 循环逻辑、Prompt 设计、工具定义、可观测性、安全护栏。Provider 层的工具调用格式差异不在这个列表里。

2. **"记 API 细节"含金量低**。OpenAI 的分片 JSON delta 和 Anthropic 的累积 JSON 前缀——这不是架构知识，是 API 文档记忆。花 2-3 天 debug 这些不如花时间在 Prompt 设计上。

3. **OpenAI 格式是事实标准**。DeepSeek、千问、GLM、Kimi 全都走 OpenAI 格式。手写一个 OpenAI 适配器覆盖 90% 的模型，但 Anthropic 的 10% 仍要单独处理。AI SDK 帮你抹平这 10%。

## 为什么不是"完全交给 SDK"

直接 `streamText({ stopWhen: stepCountIs(10) })` 一行搞定确实省事，但 ReAct 循环是 Agent 核心——不看一次自己写的循环、不亲手管理一次消息数组的增长和裁剪、不自己判断"什么时候该停"——等于跳过了 Agent 开发最重要的肌肉记忆。

**所以拆成 4a → 4b：先用手写理解，再用 SDK 生产。**

## Provider 层不动

`server/service/llm/` 下所有文件保持不变，继续为 `/api/chat` 服务。AI SDK 的 provider 映射（`server/service/agent/providers.ts`）是独立的，两条线互不干扰：

```
/api/chat        → 手写 factory.ts → OpenAIProvider / AnthropicProvider / DeepSeekProvider
/api/agent/run   → AI SDK getAgentModel() → @ai-sdk/openai / @ai-sdk/anthropic
```

## 关键洞察

- **Phase 1 手写 Provider 是"先造轮子理解轮子"——正确。Phase 2 再用 AI SDK 不是推翻 ADR-008，是 ADR-008 里预留的"Phase 3+ 重新评估"提前到了 Phase 2，因为 Phase 2 面临的格式复杂度是 Phase 1 的 3-5 倍**
- **引入 AI SDK 不等于放弃学习——4a 阶段保证了 ReAct 循环的亲手实践。删掉的是不值得学的（Provider 格式差异），保留的是必须亲手写的（循环控制、消息管理、SSE 映射）**
- **AI SDK 在本项目中只占 Agent 层约 1/3 的代码量，Prompt 工程、Skills 系统、可观测性、安全护栏——这些才是 Phase 2 的主要学习产出**
- **手写 ReAct 循环约 30 行逻辑，4a 阶段亲手写一遍、遇到问题解决、然后对比 4b 的 SDK 版本——这个路径的学习深度不比全手写差，但 debug 时间从 2-3 天降到半天**

## 相关文档

- [ADR-008: Vercel AI SDK](../decisions/008-vercel-ai-sdk.md) — Phase 1-2 不集成的原始决策，现已调整：chat 层保持自建，agent 层引入
- [Phase 2 实施方案](../../.claude/plans/radiant-toasting-gizmo.md) — 完整方案，第七节为学习路径说明
- [2026-07-09 提示词工程与 Phase 2 规划](2026-07-09-prompt-engineering-and-phase2-planning.md) — 前一天讨论：PromptSegment 抽象、可观测性、安全护栏
