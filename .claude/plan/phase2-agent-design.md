# Phase 2 Agent 系统设计方案

> 更新于 2026-07-23 · 替代旧方案 `radiant-toasting-gizmo.md`

---

## 一、方案定位

Phase 2 的核心目标是**赋予 AI 使用工具的能力**。不走"引入 AI SDK 快速上线"的捷径，也不走"手写三种协议适配"的弯路——而是聚焦在一个问题上：**ReAct 循环是怎么工作的**。

### 整个 Phase 2 只有一条学习主线

```
理解 LLM 的 tool calling 机制 → 手写 ReAct 循环 → 掌握 Agent 架构
```

其他一切（Prompt 管理、工具系统、前端 UI）都是这条主线的支撑。

---

## 二、核心架构决策

### 决策 1：Provider 层只保留 OpenAI 兼容格式

**删除 Anthropic Provider**，所有模型统一走 OpenAI 兼容 API。

| 决策 | 理由 |
|------|------|
| 只保留 OpenAI 兼容格式 | Phase 2 的学习目标是 Agent Runtime，不是多协议适配。OpenAI 格式已是事实标准（DeepSeek、千问、Kimi 全兼容） |
| 删除 `anthropic.ts` | Anthropic 的 tool_use 协议完全不同，适配成本高、学习收益低。放弃 Claude 模型是这个决策的唯一代价 |
| 保留 `deepseek.ts`（标注废弃） | 作为 Phase 1 手写 SSE 解析的学习参考，不在生产路径中使用 |

### 决策 2：使用 OpenAI SDK，不手写 HTTP/SSE

```diff
- 手写 fetch + TextDecoder + "data: " 行分割（Phase 1 已学）
+ 使用 openai npm 包（SDK 处理 HTTP 层）
+ 手写 tool call delta 累积逻辑（Phase 2 新学）
```

**关键区分**：

| 层 | 谁做 | 为什么 |
|----|------|--------|
| HTTP 请求 / SSE 字节流解析 | OpenAI SDK | Phase 1 已理解，再做是重复劳动 |
| tool call delta 跨 chunk 累积 | **自己手写** | 这是 Agent Runtime 的输入，必须理解每一步 |
| ReAct 循环控制 | **自己手写** | 核心学习目标，不能交给任何框架 |

### 决策 3：单一 Provider 类，通过配置区分服务商

不搞"每个服务商一个类"。Factory 做的事只是组装不同的构造参数：

```
         ┌─────────────────────────────┐
         │      OpenAIProvider          │
         │  (唯一的 Provider 实现类)     │
         │                             │
         │  - 使用 OpenAI SDK           │
         │  - chat() 返回               │
         │    ReadableStream<           │
         │      LLMStreamChunk>         │
         └──────────┬──────────────────┘
                    │
         ┌──────────▼──────────────────┐
         │      factory.ts              │
         │                             │
         │  'openai'   → new OpenAI... │
         │    baseUrl: api.openai.com   │
         │                             │
         │  'deepseek' → new OpenAI... │
         │    baseUrl: api.deepseek.com │
         │                             │
         │  'qianwen'  → new OpenAI... │
         │    baseUrl: dashscope.ali... │
         └─────────────────────────────┘
```

收益：升级一次工具调用逻辑，所有服务商全部获得能力。

### 决策 4：Agent 独立端点 `/api/agent/run`

不复用 `/api/chat`，新建专用于 Agent 的 SSE 端点。

| 维度 | `/api/chat` | `/api/agent/run` |
|------|-------------|-------------------|
| 生命周期 | 单次 LLM 调用 | 多轮 ReAct 循环 |
| 底层调用 | `provider.chat(messages)` | 同左，但在循环中多次调用 |
| SSE 事件 | META → TEXT → DONE | META → ROUND_START → TEXT → TOOL_START/END → DONE |
| 前端调用方 | `useChat.sendMessage()` | `useChat.sendAgentMessage()` |

底层的 `provider.chat()` 是同一个方法——Agent 只是在它之上包了一层循环。

### 决策 5：`chat()` 返回类型升级为 `LLMStreamChunk`

```ts
// 旧：Phase 1
chat(...): Promise<ReadableStream<string>>

// 新：Phase 2
chat(...): Promise<ReadableStream<LLMStreamChunk>>

// 一个 LLMStreamChunk 是以下三种之一：
// { type: 'text',       content: string }
// { type: 'tool_calls', toolCalls: ToolCall[] }
// { type: 'done' }
```

`tool_calls` 对象**不在流中间逐块发出**，而是在 LLM 流完全结束后、所有 delta 累积完整后**一次性发出**。

### 决策 6：Agent 流式 DB 写入 — 一次性写入

Agent 的 ReAct 循环期间不做增量 DB 写入。循环结束后一次性保存完整内容。这是一个已知让步——Agent 循环通常 2-3 轮、耗时短，中途刷新丢数据的概率远低于长文本流式场景。详见 [ADR-014](../../docs/decisions/014-agent-streaming-db-write.md)。

---

## 三、Provider 层精简

### 3.1 改动范围

| 文件 | 处理 | 改动量 |
|------|------|--------|
| `server/service/llm/openai.ts` | **升级** — `chat()` 返回 `LLMStreamChunk`，新增 tool call delta 累积 | ~30 行增量 |
| `server/service/llm/deepseek.ts` | **不动** — 标注废弃注释，保留为学习参考 | 0 行 |
| `server/service/llm/anthropic.ts` | **删除** | — |
| `server/service/llm/types.ts` | **升级** — `chat()` 签名变更 | 1 行 |
| `server/service/llm/factory.ts` | **精简** — 删除 Anthropic case，DeepSeek case 改为返回 OpenAIProvider | ~5 行 |
| `shared/types/provider.ts` | **扩展** — 新增 `LLMStreamChunk`、`ToolCall`、`ToolResult`、`ToolDefinition` | ~30 行 |
| `server/api/chat/index.post.ts` | **适配** — 消费 `LLMStreamChunk`，过滤非 text 事件 | ~5 行 |

### 3.2 tool call delta 累积机制

这是 Provider 升级中唯一需要手写的逻辑。OpenAI 的流式 tool calling 数据是**分片到达**的：

```
chunk 1:  delta.tool_calls[0] = { index: 0, id: "call_abc" }
chunk 2:  delta.tool_calls[0] = { index: 0, function: { name: "calc" } }
chunk 3:  delta.tool_calls[0] = { index: 0, function: { arguments: "{\"expr" } }
chunk 4:  delta.tool_calls[0] = { index: 0, function: { arguments: "ession\":" } }
chunk 5:  delta.tool_calls[0] = { index: 0, function: { arguments: "\"2+3\"}" } }
```

**累积策略**：用 `Map<index, { id, name, arguments }>` 按 index 聚拢，`name` 和 `arguments` 用字符串拼接。流结束后 Map 中的每个 entry 即是一个完整的 `ToolCall`，一次性 enqueue 为 `{ type: 'tool_calls', toolCalls: [...] }`。

**为什么不在流中间逐块发出**：arguments 是不完整的 JSON 片段，消费方（Agent Runtime）无法安全地 `JSON.parse`。Agent Runtime 拿到的一定是完整的、可执行的调用列表。

### 3.3 Factory 简化

```ts
// 伪代码
function createLLMProvider(providerId: string): LLMProvider {
  switch (providerId) {
    case 'openai':   return new OpenAIProvider({ apiKey: ..., baseUrl: 'https://api.openai.com/v1' })
    case 'deepseek': return new OpenAIProvider({ apiKey: ..., baseUrl: 'https://api.deepseek.com/v1' })
    // 千问、Kimi 等 → 同上模式
    default: throw new Error(`Unsupported provider: ${providerId}`)
  }
}
```

所有 case 返回的都是 `OpenAIProvider` 实例，区别仅在于 `baseURL` 和 `apiKey`。

---

## 四、Agent Runtime 设计

### 4.1 ReAct 循环流程

```
用户消息
  │
  ▼
┌─ 构建 system prompt ──────────────────────────────┐
│  base（角色设定）                                   │
│  + react（ReAct 指令）                              │
│  + tools（工具列表描述）                             │
│  + custom prompt（用户选择的提示词，可选）            │
└────────────────────────────────────────────────────┘
  │
  ▼
┌─ ReAct 循环（最多 N 轮）───────────────────────────┐
│                                                     │
│  ┌─ 调用 LLM（带上 tools 定义）                      │
│  │   ↓                                               │
│  │  读取 ReadableStream<LLMStreamChunk>              │
│  │   ↓                                               │
│  ├── text chunks → 流式发送给前端 → 继续读取         │
│  │   ↓                                               │
│  ├── tool_calls chunk → 跳出读取循环                  │
│  │                                                     │
│  ├─ 执行工具（并发执行所有 tool call）                │
│  │   ↓                                               │
│  ├─ 工具结果加入消息历史                              │
│  │   ↓                                               │
│  └─ 回到循环开头（下一轮 LLM 调用）                   │
│                                                     │
│  终止条件：                                          │
│  - LLM 只输出文本，没有 tool call → 结束             │
│  - 达到最大轮数 → 强制最后文本回复 → 结束             │
│  - 用户取消（AbortSignal）→ 中断                      │
└─────────────────────────────────────────────────────┘
  │
  ▼
SSE: DONE
```

### 4.2 消息数组的演变

这是理解 ReAct 循环最关键的部分——消息数组如何在每一轮增长：

```
初始:
  [system]  你是 AI 助手，有这些工具：calculator, current_time
  [user]    帮我算 235 × 17 再加 10

第 1 轮 LLM 调用:
  → LLM 返回: [text] ""  [tool_calls] calculator("235 * 17")
  → 执行 calculator → 结果: 3995
  消息数组变为:
    [system]  你是 AI 助手...
    [user]    帮我算 235 × 17 再加 10
    [assistant] { content: "", toolCalls: [{ name: "calculator", ... }] }
    [tool]    { toolCallId: "...", content: "3995" }

第 2 轮 LLM 调用:
  → LLM 看到上轮计算结果 3995，还需要加 10
  → LLM 返回: [tool_calls] calculator("3995 + 10")
  → 执行 calculator → 结果: 4005
  消息数组变为:
    [system]  你是 AI 助手...
    [user]    帮我算 235 × 17 再加 10
    [assistant] { toolCalls: [calculator("235 * 17")] }
    [tool]    { content: "3995" }
    [assistant] { toolCalls: [calculator("3995 + 10")] }
    [tool]    { content: "4005" }

第 3 轮 LLM 调用:
  → LLM 看到最终结果 4005，信息充足
  → LLM 返回纯文本: "235 × 17 = 3995，再加 10 等于 4005"
  循环结束
```

### 4.3 上下文内存管理

`AgentMemory` 类负责消息数组的存储和裁剪：

- **添加**：`add(msg)` 后自动检查是否超过阈值，超过则裁剪
- **裁剪策略**：保留 system 消息 + 最近 N 条非 system 消息。不拆散 tool call 和 tool result 的配对
- **Token 估算**：简化版（中文字符数 / 1.5 + 其他字符数 / 4），不做精确 tokenizer。精确控制留到 Phase 2d

### 4.4 模块结构

```
server/service/agent/
├── types.ts          # AgentRunConfig, AgentRound, AgentStatus
├── memory.ts         # AgentMemory — 消息数组 + 裁剪
├── runtime.ts        # runAgentLoop() — ReAct 循环主函数
└── tools/
    ├── types.ts      # ExecutableTool 接口（含 permission 字段）
    ├── registry.ts   # ToolRegistry — 注册、查询、列出定义
    ├── executor.ts   # executeToolCalls() — 并发执行 + 错误隔离
    ├── guard.ts      # sanitizeToolArgs() — 参数安全检查
    └── builtin/
        ├── calculator.ts    # 数学表达式计算（白名单运算符）
        └── current-time.ts  # 当前日期时间
```

---

## 五、数据流与 SSE 事件

### 5.1 SSE 事件类型

```ts
// 基础事件（Chat + Agent 共用）
META         → { type: 'meta', conversationId, title }
TEXT         → { type: 'text', content, conversationId }
DONE         → { type: 'done', conversationId }
ERROR        → { type: 'error', content, conversationId }
PING         → 心跳

// Agent 专属事件
ROUND_START  → { type: 'round_start', round, conversationId }
TOOL_START   → { type: 'tool_start', toolName, toolCallId, conversationId }
TOOL_END     → { type: 'tool_end', toolName, toolCallId, content, conversationId }
TOOL_ERROR   → { type: 'tool_error', toolName, toolCallId, error, conversationId }
THINKING     → { type: 'thinking', content, conversationId }
```

### 5.2 一次完整的 Agent SSE 流

```
META        → { conversationId: "abc", title: "帮我算 235 × 17" }
ROUND_START → { round: 1 }
TOOL_START  → { toolName: "calculator", toolCallId: "call_1" }
TOOL_END    → { toolName: "calculator", toolCallId: "call_1", content: "3995" }
ROUND_START → { round: 2 }
TEXT        → { content: "235" }
TEXT        → { content: " × 17 = " }
TEXT        → { content: "3995" }
DONE        → { conversationId: "abc" }
```

### 5.3 `/api/chat` 适配

`/api/chat` 底层调用同一个 `provider.chat()`，返回的 `LLMStreamChunk` 流中：
- `text` chunks → 正常流式输出
- `tool_calls` chunks → **忽略**（普通聊天不传 tools，LLM 不会返回）
- `done` chunks → **忽略**（ReadableStream 自身的 done 信号已足够）

实际只需要在原 `reader.read()` 循环中加一个类型判断。零风险改动。

---

## 六、Prompt 系统

### 6.1 Prompt 的两层含义

Phase 2 的"Prompt"有两层含义，需区分清楚：

| 概念 | 定位 | 存储 | 管理方式 |
|------|------|------|---------|
| **Prompt 模板** | 用户创建的自定义提示词（如"代码审查专家"） | Neon DB `prompts` 表 | CRUD API + Web 页面 |
| **Prompt Segment** | 代码中定义的系统指令片段（角色设定、ReAct 指令等） | 代码文件 | 文件系统 |

两者通过 `buildPrompt()` 拼装为最终发给 LLM 的 system prompt。

### 6.2 PromptSegment 拼装

```
priority: 0   → base.ts         "你是 AI 助手 Holyer..."
priority: 10  → react.ts        "你有一组可用工具，工作流程是..."
priority: 20  → tools.ts        "可用工具：1. calculator — ..."
priority: 30  → custom-prompt.ts "## 自定义提示词：代码审查专家\n..."
```

`buildPrompt(segments)` 按 priority 排序，segment 间空行分隔。每个模块只管自己的 segment，互不耦合。

### 6.3 Prompt CRUD（Phase 2 第一步）

独立的迷你交付物——用户创建/管理自定义提示词模板，对话时选择一个注入：

- DB 表：`prompts(id, name, description, prompt, created_at, updated_at)`
- API：`GET/POST /api/prompts`、`GET/PUT/DELETE /api/prompts/:id`
- Agent 集成：请求体传 `promptId`，Agent Runtime 加载后作为 priority=30 的 segment 注入

这一步对 Agent Runtime 零依赖，可独立交付。详见 [ADR-013](../../docs/decisions/013-prompt-naming.md)。

---

## 七、前端架构

### 7.1 Agent 模式切换

输入框旁新增 Agent 开关。状态存储在 `chatStore.isAgentMode`（localStorage 持久化）：

```
Agent 开关 OFF → sendMessage()     → /api/chat       (Phase 1)
Agent 开关 ON  → sendAgentMessage() → /api/agent/run  (Phase 2)
```

### 7.2 流消费共用基础设施

不新建独立 `useAgent` composable。在现有 `useChat` 的 `handleSSEEvent` 中新增 Agent 事件分支：

```ts
// 现有 switch 中新增
case 'tool_start':  chatStore.addToolCall(payload)
case 'tool_end':    chatStore.completeToolCall(payload)
case 'round_start': // 仅 dev 日志
```

Agent 和 Chat 共用 `streamSessions`、`sendingConvIds`、`switchConversation`、`restoreStreamSession` 全套基础设施。

### 7.3 新增组件

| 组件 | 用途 | 状态 |
|------|------|------|
| `ToolCallCard.vue` | 工具调用卡片 — 执行中（spinner）/ 完成（结果摘要）/ 失败（红色错误信息） | 新建 |
| `PromptSelector.vue` | 提示词选择器 — 下拉列表，显示名称和描述 | 新建 |
| `ChatInput.vue` | +Agent 开关按钮 | 修改 |
| `ChatMessage.vue` | `role='tool'` 时渲染 ToolCallCard | 修改 |

---

## 八、可观测性与安全

### 8.1 日志

`AgentLogger` 记录每次 LLM 调用和工具执行的关键信息：

- LLM 调用开始/结束：轮次、provider、model、耗时、text 长度、tool call 数量
- 工具执行：工具名、参数、结果、耗时、成功/失败
- 循环汇总：每轮结束后的状态（纯文本 / 调用了哪些工具）

纯 `console.log` 输出，不引入日志库。后续按需升级。

### 8.2 工具权限分级

| 等级 | 行为 | 示例 |
|------|------|------|
| `read` | 自动执行，不询问 | calculator、current_time |
| `write` | 自动执行，记录日志 | create_file（将来） |
| `danger` | 前端确认弹窗 | delete_file（将来） |

Phase 2 内置工具全部是 `read` 级别。

### 8.3 安全检查

- **表达式注入防护**：calculator 工具使用白名单字符检查 + 禁用关键字（`constructor`、`__proto__`、`eval` 等）
- **参数 sanitize**：`sanitizeToolArgs()` 在工具执行前检查参数格式合法性
- **最大轮数硬限制**：防止 ReAct 无限循环，默认 10 轮，可在请求中配置（1-20）

---

## 九、学习路径

### 9.1 以学习目标为导向的架构裁剪

| 学习目标 | 是否手写 | 原因 |
|----------|:---:|------|
| LLM API 协议（HTTP/SSE） | ❌ SDK 做 | Phase 1 已学 |
| tool call delta 累积逻辑 | ✅ 手写 | Phase 2 新增，Agent 输入理解 |
| ReAct 循环控制 | ✅ 手写 | 核心目标——理解 Agent 怎么"思考→行动→观察" |
| 多协议适配（Anthropic） | ❌ 删除 | 学习价值低，阻碍精力聚焦 |
| Prompt 工程（引导 LLM 正确调用工具） | ✅ 手写 | Agent 行为质量的决定性因素 |
| 工具定义设计（什么参数、什么描述） | ✅ 手写 | 影响 LLM 调用工具的准确率 |
| 上下文管理策略 | ✅ 手写 | 工程权衡——什么时候裁剪、怎么裁剪 |

### 9.2 建议的实操顺序

1. **升级 Provider**：改 `openai.ts`，让 `chat()` 能返回 `tool_calls` 类型的 chunk
2. **手写 ReAct 循环**：写一个最简单的循环，用 calculator 工具验证"LLM 调工具 → 拿到结果 → 文本回复"
3. **多轮工具调用**：测试需要 2 轮以上的场景（如"算完 A 再算 B"），理解消息数组的增长
4. **上下文裁剪**：构造一个长对话，观察裁剪策略对 LLM 行为的影响
5. **接入 DeepSeek**：切换 baseURL，观察 tool calling 质量差异——这是理解"模型能力差异"的最佳方式

### 9.3 建议的对比笔记

完成 ReAct 循环后，建议写一个简短的总结（`docs/dev-log/2026-07-xx-react-loop-learning.md`）：

- 你写的循环中有多少行是"跟 LLM 交互"，有多少行是"控制逻辑"
- 如果将来换一个更好的模型，你的循环代码要不要改
- 如果加一个新工具，需要改几个地方

这比任何教程都更能帮你内化 Agent 架构。

---

## 十、风险与缓解

| 风险 | 缓解 |
|------|------|
| DeepSeek 工具调用质量不如 OpenAI | 先基于 OpenAI 验证 ReAct 循环正确性，再切换 DeepSeek 对比。工具调用质量问题是模型限定的，不影响 Runtime 代码 |
| ReAct 循环导致 Cloudflare 100s 超时 | 30s 心跳已覆盖（`createSSEResponse` 内置）。工具执行不阻塞心跳路径 |
| LLM 无限循环调用工具 | `maxRounds` 硬上限（默认 10）+ AbortSignal 取消通道双保险 |
| `/api/chat` 改坏 | 改动 ~5 行（过滤 chunk type）。改动前后各跑一次相同对话做对比 |
| 删除 Anthropic 后想用 Claude 模型 | 短期无解。若要恢复，需参考原有 `anthropic.ts`（git 历史中保留），或等学习目标完成后重新评估 |

---

## 十一、相关文档

- [ADR-008: Vercel AI SDK — 不集成](../../docs/decisions/008-vercel-ai-sdk.md) — Phase 2 仍然不使用 AI SDK
- [ADR-009: 模型兼容性策略](../../docs/decisions/009-model-compatibility.md) — 国内模型全部走 OpenAI 格式
- [ADR-012: LLMStreamChunk 类型升级](../../docs/decisions/012-llm-stream-chunk-type.md)
- [ADR-013: Prompt 命名与实现顺序](../../docs/decisions/013-prompt-naming.md)
- [ADR-014: Agent 流式 DB 写入策略](../../docs/decisions/014-agent-streaming-db-write.md)
- [Phase 2 实现步骤](#实现步骤)（本文档第八章）
- [提示词工程与 Phase 2 规划](../../docs/dev-log/2026-07-09-prompt-engineering-and-phase2-planning.md)
- [实施路线图](../roadmap.md)

---

## 十二、实现步骤

> 本章是 Phase 2 的执行手册——按顺序描述每一步的内容、依赖、文件清单和验证方式。不含代码实现，具体代码在开发时按本文档的架构决策编写。

### 12.1 步骤概览

| 步骤 | 内容 | 预计 | 依赖 |
|:--:|------|:--:|------|
| 1 | Prompt CRUD | 1 天 | 无（DB + API 模式已就绪） |
| 2 | 共享类型扩展 | 0.5 天 | 无 |
| 3 | Prompt Segment 系统 | 0.5 天 | 步骤 2 |
| 4 | 工具系统 | 1 天 | 步骤 2 |
| 5 | Provider 升级 + Factory 精简 | 1 天 | 步骤 2 |
| 6 | Agent Runtime | 1 天 | 步骤 3, 4, 5 |
| 7 | Agent API 端点 | 0.5 天 | 步骤 1, 6 |
| 8 | `/api/chat` 适配 | 0.5 天 | 步骤 5 |
| 9 | Agent UI | 1 天 | 步骤 7, 8 |
| 10 | 可观测性 + 安全护栏 | 0.5 天 | 步骤 4, 6 |

> 总预计：4-6 天。Provider 层精简（删除 Anthropic、合并 DeepSeek 到 OpenAIProvider）是时间减少的主要原因。

### 12.2 依赖关系图

```
步骤 1: Prompt CRUD ────────────────────────────┐
    │ (零依赖，独立交付)                          │
    │ 为步骤 7 提供 Prompt 注入管线               │
    │                                             │
    ▼                                             │
步骤 2: 共享类型扩展 ───────────────────────────┐ │
    │ (无依赖)                                    │ │
    ▼                                             │ │
步骤 3: Prompt Segment ──── 步骤 4: 工具系统 ───┤ │
    │ (依赖步骤 2)              │ (依赖步骤 2)    │ │
    ▼                           ▼                 │ │
步骤 5: Provider 升级 + Factory 精简             │ │
    │ (依赖步骤 2)                                │ │
    │ (删除 anthropic.ts)                         │ │
    ▼                                             │ │
步骤 6: Agent Runtime ───────────────────────────┤ │
    │ (依赖步骤 3, 4, 5)                          │ │
    ▼                                             │ │
步骤 7: Agent API ──── 步骤 8: /api/chat 适配 ──┤ │
    │ (依赖步骤 1, 6)       (依赖步骤 5)          │ │
    ▼                         ▼                   │ │
步骤 9: Agent UI ────────────────────────────────┤ │
    │ (依赖步骤 7, 8)                             │ │
    ▼                                             │ │
步骤 10: 可观测性 + 安全 ────────────────────────┘ │
          (依赖步骤 4, 6 — 可最后做)
```

### 12.3 开发策略

按四个阶段推进，每阶段结束有独立验证节点：

```
┌─ 阶段 A：自定义提示词管理 — 独立交付、零依赖 ─────────────────┐
│ 步骤 1                                                          │
│                                                                  │
│ 纯 CRUD：DB Schema → Service → 5 个 REST API 端点。              │
│ 不涉及 Prompt Segment、Agent Runtime 或 Provider 改造。          │
│                                                                  │
│ ★ 这一步跑通后，用户已经可以通过自定义提示词创建"简易 Agent"。  │
│   不需要 ReAct 循环，不需要工具系统，就是 OpenAI Custom GPTs。   │
└──────────────────────────────────────────────────────────────────┘

┌─ 阶段 B：纯后端基础设施 — 可离线开发 ──────────────────────────┐
│ 步骤 2 → 3 → 4                                                   │
│                                                                  │
│ 不涉及 Provider 改造，也不涉及 HTTP 端点。                       │
│ 写完即可用简单脚本验证：                                         │
│                                                                  │
│ 验证 1: buildPrompt([base, react, tools]) 输出正确               │
│ 验证 2: toolRegistry.listDefinitions() 返回内置工具              │
│ 验证 3: calculator.execute('{"expression":"2+3*4"}') → 14       │
│ 验证 4: executeToolCalls([...]) 并发执行 + 错误隔离              │
│                                                                  │
│ ★ 这个阶段不需要 LLM API Key，可以离线完成。                     │
└──────────────────────────────────────────────────────────────────┘

┌─ 阶段 C：Provider 改造 + Runtime 串通 ─────────────────────────┐
│ 步骤 5 → 6 → 7 → 8                                               │
│                                                                  │
│ 核心阶段。推荐顺序：                                             │
│                                                                  │
│ 5a. 先改 OpenAI Provider（唯一的 Provider 实现类）               │
│     → tool call delta 累积逻辑是本次唯一需要手写的部分           │
│                                                                  │
│ 5b. 精简 Factory + 删除 anthropic.ts                             │
│     → DeepSeek case 改为返回 OpenAIProvider（仅 baseURL 不同）   │
│                                                                  │
│ 6.  写 Agent Runtime + API 端点                                  │
│     → 用 OpenAI 模型验证 ReAct 循环跑通                          │
│     → curl 测试：算数（触发 calculator 工具）                    │
│     → ★ 此时步骤 1 的 Prompt 已可注入 Agent API（promptId 参数） │
│                                                                  │
│ 8.  最后改 /api/chat（步骤 8）                                   │
│     → 改动 ~5 行（过滤 chunk.type）                              │
│     → 改完后回归测试：普通聊天是否正常？                          │
│                                                                  │
│ ★ 关键风险点：                                                   │
│ - OpenAI tool call delta 的 index 不一定连续（并行 tool call）    │
│ - /api/chat 改完后务必回归测试纯文本流式对话                      │
│ - 删除 anthropic.ts 后检查全项目无残留 import                     │
└──────────────────────────────────────────────────────────────────┘

┌─ 阶段 D：UI + 打磨 ────────────────────────────────────────────┐
│ 步骤 9 → 10                                                      │
│                                                                  │
│ 9. Agent UI — 先做后端对接，再做视觉组件                         │
│    → 9a: 新建 app/api/agent.ts（API 封装，同 chat.ts 模式）     │
│    → 9b: 在 useChat.ts 的 handleSSEEvent 中加 Agent 事件分支     │
│    → 9c: 加 sendAgentMessage 方法 + Agent 开关                   │
│    → 9d: 最后写 ToolCallCard.vue + PromptSelector.vue 组件       │
│                                                                  │
│ 10. 可观测性 + 安全护栏 — 不影响功能，最后加                     │
│     → logger.ts 写好就能用，纯 console.log，无外部依赖            │
│     → guard.ts 在 executeToolCalls 中调用 sanitizeToolArgs        │
│                                                                  │
│ ★ 步骤 9 依赖步骤 8（/api/chat 适配后前端流类型逻辑才一致）      │
└──────────────────────────────────────────────────────────────────┘
```

### 12.4 各步骤详细说明

#### 步骤 1：Prompt CRUD（1 天）— 独立交付

**内容**：DB Schema → Service → 5 个 REST API 端点。用户可在 Web 页面创建/管理自定义提示词模板，对话时选择一个注入为系统上下文。

**设计要点**：
- Prompt 是纯提示词模板，不含工具白名单或模型推荐——工具是 Agent Runtime 的职责
- Prompt + 工具列表 = Agent 能力。LLM 看到自定义提示词 + 工具列表，自然按提示词引导调用工具
- 存储：Neon PostgreSQL `prompts` 表

**文件**：
```
新建：
  server/db/schema/prompts.ts              # DB Schema（id, name, description, prompt, created_at, updated_at）
  server/service/prompts/types.ts           # Prompt 类型 + CreatePromptInput + UpdatePromptInput
  server/service/prompts/service.ts         # CRUD Service（list/getById/create/update/delete）
  server/api/prompts/index.get.ts           # GET  /api/prompts — 列表
  server/api/prompts/index.post.ts          # POST /api/prompts — 创建
  server/api/prompts/[id].get.ts            # GET  /api/prompts/:id — 详情
  server/api/prompts/[id].put.ts            # PUT  /api/prompts/:id — 更新
  server/api/prompts/[id].delete.ts         # DELETE /api/prompts/:id — 删除

修改：
  server/db/schema/index.ts                # 导出 prompts 表
```

**验证**：
```bash
# 1. 创建 → 2. 列表 → 3. 详情 → 4. 更新 → 5. 删除
curl -X POST http://localhost:3000/api/prompts -H 'Content-Type: application/json' \
  -d '{"name":"代码审查专家","description":"审查代码","prompt":"你是资深代码审查专家..."}'
curl http://localhost:3000/api/prompts
curl http://localhost:3000/api/prompts/<id>
curl -X PUT http://localhost:3000/api/prompts/<id> -H 'Content-Type: application/json' \
  -d '{"name":"代码审查专家 V2"}'
curl -X DELETE http://localhost:3000/api/prompts/<id>
```

---

#### 步骤 2：共享类型扩展（0.5 天）

**内容**：定义 Phase 2 所有模块依赖的核心类型。

**关键变化（vs 旧方案）**：不再需要 Anthropic 特有的类型（`content_block_start`/`content_block_delta` 等），因为 Anthropic Provider 会被删除。

**文件**：
```
修改：
  shared/types/provider.ts     # 新增 LLMStreamChunk、ToolCall、ToolResult、ToolDefinition、Message（扩展 toolCalls/toolCallId 字段）
  shared/types/sse.ts           # 新增 ROUND_START、TOOL_START、TOOL_END、TOOL_ERROR、THINKING
  server/service/llm/types.ts   # chat() 返回类型: ReadableStream<string> → ReadableStream<LLMStreamChunk>
```

**类型定义要点**：
- `LLMStreamChunk = { type: 'text', content } | { type: 'tool_calls', toolCalls } | { type: 'done' }`
- `ToolCall = { id, name, arguments }`（arguments 是 JSON 字符串）
- `ToolResult = { toolCallId, name, content, error? }`
- `ToolDefinition = { name, description, parameters }`（parameters 是 JSON Schema）
- `Message` 新增 `toolCalls?: ToolCall[]` 和 `toolCallId?: string`

**验证**：`npx nuxi typecheck` 零错误。所有类型可正常 import。

---

#### 步骤 3：Prompt Segment 系统（0.5 天）

**内容**：`buildPrompt()` 按 priority 拼装多个 segment。每个模块只管自己的 segment，互不耦合。

**文件**：
```
新建：
  server/service/prompt/types.ts              # PromptSegment { id, priority, content }
  server/service/prompt/builder.ts            # buildPrompt() + estimateTokens()
  server/service/prompt/segments/base.ts      # 角色设定（priority=0）
  server/service/prompt/segments/react.ts     # ReAct 指令（priority=10）
  server/service/prompt/segments/tools.ts     # 工具列表描述（priority=20）
  server/service/prompt/segments/custom-prompt.ts  # 用户 Prompt 注入（priority=30）
```

**priority 约定**：
```
0   — 基础角色设定
10  — ReAct 指令
20  — 工具列表
30  — 用户自定义 Prompt 注入
40  — 将来：RAG 检索结果
50  — 将来：长期记忆/偏好
```

**验证**：调用 `buildPrompt([base, react, tools])` 输出顺序正确、segment 间空行分隔。

---

#### 步骤 4：工具系统（1 天）

**内容**：ToolRegistry 单例 + ExecutableTool 接口 + 并发执行器 + 两个内置工具。

**设计要点**：
- `ToolDefinition`（共享类型）描述工具的"样子"（给 LLM 看），`ExecutableTool` 包含实际执行函数（给 Runtime 用）
- 工具权限分三级：`read`（自动执行）、`write`（自动执行+日志）、`danger`（需用户确认）。Phase 2 内置工具全部是 `read`
- `executeToolCalls()` 使用 `Promise.allSettled` 并发执行，单个工具失败不阻塞其他工具

**文件**：
```
新建：
  server/service/agent/tools/types.ts           # ExecutableTool 接口（含 permission、requireConfirm、execute）
  server/service/agent/tools/registry.ts        # ToolRegistry 单例（register/get/listDefinitions/listNames/has）
  server/service/agent/tools/executor.ts        # executeToolCalls() — 并发执行 + 错误隔离
  server/service/agent/tools/builtin/calculator.ts    # 数学表达式计算（白名单字符 + 关键字过滤 + Function 隔离）
  server/service/agent/tools/builtin/current-time.ts  # 当前日期时间（支持 full/date/time 格式）
```

**验证**：
- `calculator.execute('{"expression":"2+3*4"}')` → `"14"`
- `currentTime.execute('{"format":"full"}')` → 当前日期时间字符串
- `executeToolCalls([{name:"unknown",...}])` → `{ error: "未知工具：unknown" }`

---

#### 步骤 5：Provider 升级 + Factory 精简（1 天）⚠️ 核心变化

**内容**：
- **升级 `openai.ts`**：`chat()` 返回 `ReadableStream<LLMStreamChunk>`，新增 tool call delta 累积逻辑
- **删除 `anthropic.ts`**：Anthropic 的 tool_use 协议适配成本高、学习收益低
- **不修改 `deepseek.ts`**：标注 `@deprecated`，保留为学习参考，不在生产路径使用
- **精简 `factory.ts`**：删除 Anthropic case，DeepSeek case 返回 `OpenAIProvider`（仅 baseURL 不同）

**tool call delta 累积机制**（唯一需要手写的部分）：

OpenAI 流式 tool calling 数据分片到达——一个 tool call 的 `id`、`name`、`arguments` 分散在多个 chunk 中。累积策略：

- 用 `Map<index, { id, name, arguments }>` 按 index 聚拢
- `id` 用赋值（只在第一个 chunk 出现）、`name` 和 `arguments` 用字符串拼接
- 流完全结束后，Map 中的每个 entry 即为一个完整的 `ToolCall`
- 一次性 enqueue 为 `{ type: 'tool_calls', toolCalls: [...] }`

**为什么不在流中间逐块发出**：arguments 是不完整的 JSON 片段，消费方无法安全 `JSON.parse`。Agent Runtime 拿到的一定是完整的、可执行的调用列表。

**文件**：
```
修改：
  server/service/llm/openai.ts      # ~30 行增量：tool call delta 累积（Map<index, {...}>）
  server/service/llm/factory.ts     # 删除 Anthropic case；DeepSeek case → new OpenAIProvider({ baseUrl: 'https://api.deepseek.com/v1' })
  server/service/llm/deepseek.ts    # 仅标注 @deprecated 注释，不改逻辑

删除：
  server/service/llm/anthropic.ts   # 删除整个文件
```

**验证**：
- 用 OpenAI 模型发带 tools 的请求，SSE 流中能看到 `tool_calls` chunk
- 用 DeepSeek 模型（通过 OpenAIProvider + deepseek baseURL）发同样请求，行为一致
- typecheck 零错误（删除 Anthropic 后无残留引用）
- `grep -r "anthropic" server/` 仅 `deepseek.ts` 中可能有注释提及，无实际调用

---

#### 步骤 6：Agent Runtime（1 天）⭐ 核心学习目标

**内容**：实现 ReAct 循环——Phase 2 的首要学习目标。

**ReAct 循环流程**：
1. 通过 PromptSegment 拼装 system prompt（base + react + tools + custom prompt）
2. 调用 LLM（带 tools 定义）
3. 读取 `LLMStreamChunk` 流
   - `text` chunks → 流式发送给前端 → 继续读取直到流结束
   - `tool_calls` chunk（流结束后的一次性事件）→ 跳出读取循环
4. 执行工具（并发执行所有 tool call）
5. 工具结果加入消息历史（assistant + tool 消息配对）
6. 回到步骤 2（下一轮 LLM 调用）

**终止条件**：
- LLM 只输出文本，没有 tool call → 自然结束
- 达到 `maxRounds`（默认 10）→ 强制最后文本回复
- AbortSignal 触发 → 中断

**消息数组的演变**（核心学习内容）：
```
初始:
  [system]  你是 AI 助手，有这些工具：calculator
  [user]    帮我算 235 × 17 再加 10

第 1 轮 LLM 调用 → LLM 返回 tool_calls: calculator("235 * 17")
  + [assistant] { toolCalls: [{ name: "calculator", arguments: '{"expression":"235*17"}' }] }
  + [tool]     { toolCallId: "...", content: "3995" }

第 2 轮 LLM 调用 → LLM 看到结果 3995，还需要加 10 → tool_calls: calculator("3995 + 10")
  + [assistant] { toolCalls: [{ name: "calculator", arguments: '{"expression":"3995+10"}' }] }
  + [tool]     { toolCallId: "...", content: "4005" }

第 3 轮 LLM 调用 → LLM 信息充足，返回纯文本
  + [assistant] { content: "235 × 17 = 3995，再加 10 等于 4005" }
  循环结束
```

**AgentMemory 裁剪策略**：
- 按消息条数裁剪（默认保留 40 条）
- system 消息不删除
- 不拆散 tool call 和 tool result 的配对
- Token 估算用简化公式（中文 ~1.5 chars/token，其他 ~4 chars/token），不做精确 tokenizer

**文件**：
```
新建：
  server/service/agent/types.ts      # AgentRunConfig、AgentRound、AgentStatus
  server/service/agent/memory.ts     # AgentMemory（消息存储 + 裁剪 + token 估算）
  server/service/agent/runtime.ts    # runAgentLoop() — ReAct 循环主函数
```

**验证**：
- 用 OpenAI 模型测试："算 3×5" → LLM 调用 calculator → 结果 15 → 文本回复
- 测试多轮："先算 10+20，再把结果乘以 3" → 两轮工具调用 → 结果 90
- 测试无工具场景："你好" → 纯文本回复，无工具调用

---

#### 步骤 7：Agent API 端点（0.5 天）

**内容**：独立的 `/api/agent/run` SSE 端点，不复用 `/api/chat`。

**端点设计**：

| 维度 | `/api/chat` | `/api/agent/run` |
|------|-------------|-------------------|
| 生命周期 | 单次 LLM 调用 | 多轮 ReAct 循环 |
| 底层调用 | `provider.chat(messages)` | 同左，但在循环中多次调用 |
| SSE 事件 | META → TEXT → DONE | META → ROUND_START → TEXT/TOOL_START/END → DONE |
| 前端调用方 | `useChat.sendMessage()` | `useChat.sendAgentMessage()` |

**请求体**（Zod 验证）：
- `provider`：provider ID
- `model`：模型名
- `message`：用户消息数组
- `conversationId`：可选，关联已有对话
- `maxRounds`：可选，最大轮数（默认 10）
- `promptId`：可选，用户选择的 Prompt ID
- `systemPrompt`：可选，覆盖 prompt 的自定义 system prompt

**已知让步**（ADR-014）：Agent 循环期间不做增量 DB 写入，流结束后一次性保存。ReAct 循环通常 2-3 轮、耗时短，中途刷新丢数据的概率远低于长文本流式场景。

**文件**：
```
新建：
  server/api/agent/schema.ts        # AgentRunSchema（Zod）
  server/api/agent/run.post.ts      # SSE 端点：验证 → 创建对话 → 保存用户消息 → runAgentLoop → SSE 流
```

**验证**：
```bash
# 测试基本 Agent（计算器）
curl -N -X POST http://localhost:3000/api/agent/run \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai","model":"gpt-4o-mini","message":[{"role":"user","content":"算 345 × 678"}]}'

# 测试纯对话（无工具）
curl -N -X POST http://localhost:3000/api/agent/run \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai","model":"gpt-4o-mini","message":[{"role":"user","content":"你好"}]}'

# 测试 Prompt 注入
curl -N -X POST http://localhost:3000/api/agent/run \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai","model":"gpt-4o-mini","message":[{"role":"user","content":"审查这段代码"}],"promptId":"<id>"}'
```

---

#### 步骤 8：`/api/chat` 适配（0.5 天）

**内容**：`/api/chat` 底层调用同一个 `provider.chat()`（返回 `ReadableStream<LLMStreamChunk>`），适配方式极简。

**改动**：在 `reader.read()` 循环中加类型判断：
- `chunk.type === 'text'` → 正常流式输出（原逻辑）
- `chunk.type === 'tool_calls'` → 忽略（普通聊天不传 tools，LLM 不会返回）
- `chunk.type === 'done'` → 忽略（ReadableStream 自身的 done 信号已足够）

**改动量**：~5 行。

**风险控制**：改动前先跑一次正常对话确认基线行为，改动后立即跑同样的对话对比。

**验证**：浏览器中正常聊天，流式输出无中断、无类型错误。

---

#### 步骤 9：Agent UI（1 天）

**内容**：

**① Agent 模式开关**：输入框旁新增开关，状态存入 `chatStore.isAgentMode`（localStorage 持久化）。
- OFF → `sendMessage()` → `/api/chat`（Phase 1 行为）
- ON → `sendAgentMessage()` → `/api/agent/run`（Phase 2 行为）

**② 扩展 `useChat`**：不新建独立 composable。Agent 和 Chat 共用 `streamSessions`、`sendingConvIds`、`switchConversation`、`restoreStreamSession` 全套基础设施。新增：
- `handleSSEEvent` 中新增 Agent 事件分支（ROUND_START、TOOL_START、TOOL_END、TOOL_ERROR、THINKING）
- `sendAgentMessage()` 方法（同 `sendMessage` 模式，区别是调用 `/api/agent/run`）
- 响应式状态：`agentCurrentRound`、`agentToolCalls`、`isAgentMode`

**③ ToolCallCard 组件**：工具调用卡片，三种状态——执行中（spinner 动画）、完成（结果摘要）、失败（红色错误信息）

**④ PromptSelector 组件**：提示词选择器下拉列表，显示名称和描述。选中后 `sendAgentMessage` 携带 `promptId`。`onMounted` 时调用 `GET /api/prompts` 获取列表

**文件**：
```
新建：
  app/api/agent.ts                       # AgentApi.run()（fetch 封装，同 app/api/chat.ts 模式）
  app/components/agent/ToolCallCard.vue  # 工具调用卡片组件
  app/components/agent/PromptSelector.vue # 提示词选择器组件

修改：
  app/composables/useChat.ts             # 新增 Agent 事件处理 + sendAgentMessage + Agent 状态
  app/components/ChatInput.vue           # 新增 Agent 模式开关
  app/components/ChatMessage.vue         # role='tool' 时渲染 ToolCallCard
```

**验证**：
- 浏览器中 Agent 开关 ON，发送 "算 3×5"，工具调用卡片出现在消息流中
- 切换开关 OFF，发送普通消息，行为与 Phase 1 完全一致
- 选择 Prompt 后发送 Agent 消息，回复风格符合 Prompt 设定

---

#### 步骤 10：可观测性 + 安全护栏（0.5 天）

**内容**：

**① AgentLogger**：记录每次 LLM 调用和工具执行的关键信息。
- LLM 调用：轮次、provider、model、消息数、text 输出长度、tool call 数量
- 工具执行：工具名、参数、结果、成功/失败
- 每轮汇总：本轮状态（纯文本 / 调用了哪些工具）
- 实现：纯 `console.log`，不引入日志库。数组内存存储，提供 `getLogs()` / `clear()` 方法

**② 安全护栏**：
- **参数合法性**：检查参数是否为合法 JSON + 长度限制（最大 10000 字符）
- **表达式注入防护**：calculator 使用白名单字符检查 + 禁用关键字（`constructor`、`__proto__`、`eval`、`Function`、`globalThis`、`window`、`document`、`process`、`require`、`import`、`fetch`）
- **权限分级**：所有内置工具为 `read` 级别，自动执行不询问

**文件**：
```
新建：
  server/service/agent/observability/logger.ts  # AgentLogger（llmCallStart/End、toolCall、toolResult、roundSummary）
  server/service/agent/tools/guard.ts           # sanitizeToolArgs() + checkToolGuard()
```

**验证**：终端能看到每次 LLM 调用和工具执行的结构化日志。

---

### 12.5 完整文件清单

```
新建文件（~25 个）：
├── server/db/schema/prompts.ts                       # DB Schema
├── server/service/prompts/types.ts + service.ts      # CRUD Service
├── server/api/prompts/index.get.ts + index.post.ts   # REST API
├── server/api/prompts/[id].get.ts + [id].put.ts + [id].delete.ts
├── server/service/prompt/types.ts + builder.ts       # Prompt Segment
├── server/service/prompt/segments/base.ts + react.ts + tools.ts + custom-prompt.ts
├── server/service/agent/types.ts + memory.ts + runtime.ts  # Agent Runtime
├── server/service/agent/tools/types.ts + registry.ts + executor.ts + guard.ts
├── server/service/agent/tools/builtin/calculator.ts + current-time.ts
├── server/service/agent/observability/logger.ts
├── server/api/agent/schema.ts + run.post.ts          # Agent API
├── app/api/agent.ts                                  # 前端 API 封装
├── app/components/agent/ToolCallCard.vue + PromptSelector.vue

修改文件（~8 个）：
├── shared/types/provider.ts                          # 新增 LLMStreamChunk 等类型
├── shared/types/sse.ts                               # 新增 Agent SSE 事件
├── server/service/llm/types.ts                       # chat() 签名变更
├── server/service/llm/openai.ts                      # tool call delta 累积（~30 行）
├── server/service/llm/factory.ts                     # 删除 Anthropic case
├── server/db/schema/index.ts                         # 导出 prompts 表
├── server/api/chat/index.post.ts                     # 适配 LLMStreamChunk（~5 行）
├── app/composables/useChat.ts                        # Agent 事件处理 + sendAgentMessage

删除文件（1 个）：
├── server/service/llm/anthropic.ts

不修改：
├── server/service/llm/deepseek.ts                    # 仅标注 @deprecated，不改逻辑
```

### 12.6 完整验证清单

每完成一个步骤，跑对应的验证。不要攒到最后一起测——ReAct 循环的 bug 极难定位。

| 步骤 | 验证方式 | 通过标准 |
|------|---------|---------|
| 1 | curl 测试 Prompts CRUD | POST 创建 → GET 列表包含 → GET 详情 → PUT 更新 → DELETE 删除返回空列表 |
| 2 | `npx nuxi typecheck` | 零错误。新增类型可正常 import |
| 3 | 临时脚本调用 `buildPrompt()` | 输出包含角色设定 + ReAct 指令 + 工具列表，顺序正确 |
| 4 | 临时脚本调用 `executeToolCalls()` | 计算器返回正确结果、时间工具返回当前时间、未知工具返回 error |
| 5 | curl 带 tools 的请求到 `/api/chat` | SSE 流中看到 `tool_calls` chunk（OpenAI），或文本正常返回 |
| 6 | `npx nuxi typecheck` + dev 启动 | typecheck 零错误，dev 启动无运行时 crash |
| 7 | curl 测试 `/api/agent/run` | SSE 事件流包含完整 ReAct 序列，calculator 工具被正确调用 |
| 8 | 浏览器中正常聊天 | 文本流式输出正常，无类型错误，无中断 |
| 9 | 浏览器中触发 Agent 模式 | 工具调用卡片出现在消息流中，TEXT 事件正常追加 |
| 10 | 检查终端 console 输出 | 每次 LLM 调用和工具执行都有结构化日志 |

### 12.7 关键风险

| 风险 | 发生时机 | 预防措施 |
|------|---------|---------|
| **Prompt DB 迁移失败** | 步骤 1 | Drizzle Schema 写完后立即 `npx drizzle-kit push` |
| **OpenAI tool call delta index 错位** | 步骤 5 | 打印每次 delta 的 index/id/name/arguments，观察连续性 |
| **ReAct 无限循环** | 步骤 6 | `maxRounds` 硬上限（默认 10）+ AbortSignal 双保险 |
| **`/api/chat` 改坏** | 步骤 8 | 改前跑一次基线对话，改后立即对比 |
| **前端事件路由错乱** | 步骤 9 | 确认 `eventConvId === chatStore.currentConvId` 校验在所有新 case 中都存在 |
| **Cloudflare 100s 超时** | 部署后 | Agent 多轮可能超过 100s。30s 心跳已覆盖，但需确认工具执行不阻塞心跳路径 |
| **删除 Anthropic 后想用 Claude 模型** | — | 短期无解。如需恢复，参考 git 历史中的 `anthropic.ts`，或等学习目标完成后重新评估 |

### 12.8 推荐工作节奏

```
Day 1 上午: 步骤 1 — Prompt CRUD DB Schema + Service + API (2h)
Day 1 下午: 步骤 1 收尾 → curl 验证 (1h) → 步骤 2 — 共享类型扩展 (1h)
            ★ 第一天结束即可交付"简易 Agent"

Day 2 上午: 步骤 3 — Prompt Segment 系统 (1.5h) → typecheck
Day 2 下午: 步骤 4 — 工具系统 (3h) → 验证 calculator/current_time/executor
            ★ 纯后端模块全部完成，可离线单测

Day 3 上午: 步骤 5a — OpenAI Provider tool calling (2h)
Day 3 下午: 步骤 5b — Factory 精简 + 删除 Anthropic (1h) → 步骤 6 — Agent Runtime (3h)
            ★ 用 OpenAI 验证 ReAct 循环跑通

Day 4 上午: 步骤 7 — Agent API + curl 验证 (1.5h)
Day 4 下午: 步骤 8 — /api/chat 适配 + 回归 (1h) → 步骤 9a-9c — Agent UI 后端对接 (2h)
            ★ Agent 端到端跑通

Day 5 上午: 步骤 9d-9e — ToolCallCard + PromptSelector 组件 (2h)
Day 5 下午: 步骤 10 — 可观测性 + 安全护栏 (1.5h) → 端到端测试 (1h)

缓冲 1-2 天: 处理意外 bug
```
