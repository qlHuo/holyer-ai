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

### 决策 4：保持 `/api/chat` 单端点，Agent 是 Chat 的超集

**2026-07-30 修正**：原决策要求新建独立 `/api/agent/run` 端点，经分析后修正——不复用不是设计问题，Agent 就是 Chat 的超集（传了工具列表而已）。

业界验证：OpenAI `/v1/chat/completions`、Anthropic `/v1/messages`、Gemini、DeepSeek——全部是单端点。没有人把 Agent 和 Chat 分成两个 API。

```ts
// 路由逻辑：有注册工具就走 Agent 路径，否则纯聊天
const toolDefinitions = toolRegistry.getDefinitions()  // 始终全量，前端不参与选择
const rawStream = toolDefinitions.length > 0
  ? await runAgentLoop(llmProvider, allMessages, chatOptions)
  : await llmProvider.chat(allMessages, chatOptions)
```

| 维度 | 纯聊天路径 | Agent 路径 |
|------|-----------|-----------|
| 触发条件 | `toolRegistry.getDefinitions().length === 0` | 有注册工具时始终走 |
| LLM 调用 | 单次 `provider.chat()` | ReAct 循环内多次调用 |
| SSE 事件 | META → TEXT → DONE | META → ROUND_START → TOOL_START/END → TEXT → DONE |
| 用户感知 | 无差异 | 无差异——Agent 能力透明，无需开关 |

**不需要 Agent 开关**：ChatGPT、Claude、Gemini 都是自动判断，用户不需要选择"要不要启用工具"。LLM 看到"你好"不会去调计算器，看到"现在几点了"自然会调。

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

> **2026-07-26 更新**：实际实施中，Provider 精简的连锁反应超出上表。`provider` 字段被从 DB Schema (`conversations.provider` 列)、Zod 校验、共享类型、前端 Store、前端 UI（Provider 选择器）全链路移除，共涉及 21 个文件，净删 259 行。环境变量从 6 个 per-provider 统一为 2 个。详见 [2026-07-26 Provider 维度移除全栈实施](../../docs/dev-log/2026-07-26-provider-simplification.md)。

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
// 伪代码（设计阶段）
function createLLMProvider(providerId: string): LLMProvider {
  switch (providerId) {
    case 'openai':   return new OpenAIProvider({ apiKey: ..., baseUrl: 'https://api.openai.com/v1' })
    case 'deepseek': return new OpenAIProvider({ apiKey: ..., baseUrl: 'https://api.deepseek.com/v1' })
    // 千问、Kimi 等 → 同上模式
    default: throw new Error(`Unsupported provider: ${providerId}`)
  }
}
```

> **2026-07-26 更新**：实际实施比设计更进一步——`createLLMProvider()` 改为无参，不再接受 `providerId`。环境变量从 6 个 per-provider 统一为 `NUXT_MODEL_API_KEY` + `NUXT_MODEL_BASE_URL`。同时 `provider` 字段从 DB Schema、API、前端 Store/UI 全链路移除。详见 [2026-07-26 Provider 维度移除全栈实施](../../docs/dev-log/2026-07-26-provider-simplification.md)。

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
│  │  读完 ReadableStream<LLMStreamChunk>              │
│  │  分离 text 和 tool_calls                          │
│  │   ↓                                               │
│  ├── 无 tool_calls → 最后一轮                        │
│  │   │  发出 ROUND_START → emit text → DONE          │
│  │   │  循环结束                                     │
│  │   ↓                                               │
│  ├── 有 tool_calls → 中间轮                          │
│  │   │  发出 ROUND_START                              │
│  │   │  并发执行所有 tool call（Promise.allSettled）   │
│  │   │  每次完成发出 TOOL_START → TOOL_END            │
│  │   │  工具结果写入 AgentMemory                      │
│  │   │  回到循环开头（下一轮 LLM 调用）                │
│  │                                                     │
│  终止条件：                                          │
│  - LLM 只输出文本，没有 tool call → 结束             │
│  - 达到最大轮数 → 强制最后文本回复 → 结束             │
│  - 用户取消（AbortSignal）→ 中断                      │
└─────────────────────────────────────────────────────┘
  │
  ▼
SSE: DONE
```

**关键设计**：

- **中间轮次不发文本**：LLM 在中间轮说的"我来查一下"对用户无价值，只发 ROUND_START + TOOL_START/END
- **最后一轮直接 emit 已读到的文本**：第一轮就读完了流，检测到无 tool_calls 后直接发出 text content。对于短回复（如"你好"→20 tokens）逐 token 流式无意义；长回复后续可用 `tee()` 优化
- **工具并发**：LLM 一次返回 3 个 tool_calls 时并发执行，不等第一个完成再开始第二个

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
├── types.ts          # AgentEvent、AgentRunConfig
├── memory.ts         # AgentMemory — 消息数组 + 裁剪 + token 估算
├── runner.ts         # runAgentLoop() — AsyncGenerator<AgentEvent>
└── tools/
    ├── types.ts      # ExecutableTool 接口（含 permission 字段）
    ├── registry.ts   # ToolRegistry — 注册、查询、列出定义
    ├── index.ts      # 模块初始化 + 自动注册所有内置工具
    └── builtin/
        ├── calculator.ts      # 数学表达式计算
        ├── current-time.ts    # 当前日期时间
        ├── web-search.ts      # 互联网搜索（Brave Search API）
        ├── web-fetch.ts       # 网页文本抓取
        ├── date-calculator.ts # 日期偏移计算
        ├── unit-converter.ts  # 单位换算
        ├── text-stats.ts      # 文本统计
        └── json-formatter.ts  # JSON 格式化/校验
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
TOOL_START   → { type: 'tool_start', toolName, toolCallId, args, conversationId }
TOOL_END     → { type: 'tool_end', toolName, toolCallId, result, conversationId }
REASONING    → { type: 'reasoning', content, conversationId }  // 预留，Phase 3+
```

### 5.2 一次完整的 Agent SSE 流

```
用户："帮我算 123 × 456，再告诉我现在几点"

META          { conversationId: "abc", title: "..." }
ROUND_START   { round: 1, conversationId: "abc" }
TOOL_START    { toolName: "calculator", toolCallId: "c1", args: '{"expression":"123*456"}' }
TOOL_END      { toolName: "calculator", toolCallId: "c1", result: "56088" }
TOOL_START    { toolName: "current_time", toolCallId: "c2", args: '{"timezone":"Asia/Shanghai"}' }
TOOL_END      { toolName: "current_time", toolCallId: "c2", result: "2026年7月30日 15:30 CST" }
ROUND_START   { round: 2, conversationId: "abc" }
TEXT          { content: "123 × 456 = 56088，现在是北京时间 2026年7月30日下午3点30分。" }
DONE          { conversationId: "abc" }
```

### 5.3 `/api/chat` 流消费

`/api/chat` 始终将 `toolRegistry.getDefinitions()` 全量传给 LLM。Router 根据工具注册情况分路径：

**Agent 路径**（有注册工具时）：

```ts
const eventStream = runAgentLoop(llmProvider, allMessages, chatOptions)
for await (const event of eventStream) {
  switch (event.type) {
    case 'round_start': controller.enqueue(...); break
    case 'tool_start':  controller.enqueue(...); break
    case 'tool_end':    controller.enqueue(...); break
    case 'text':        // 最后一轮文本 → 增量写入 DB
                        controller.enqueue(TEXT); updateMessage(...); break
    case 'done':        break
    case 'error':       controller.enqueue(ERROR); break
  }
}
```

**纯聊天路径**（零工具注册时）：现有逻辑不变——`filterTextChunks` → `while(true) read()` → TEXT 增量写入。

**DB 写入策略**：最后一轮的 TEXT 走增量写入（同纯聊天），中间轮的 tool 消息在循环结束后批量写入。

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

### 7.1 透明 Agent

Agent 能力对用户完全透明——不需要开关，不需要手动选择工具。LLM 自行判断是否调用工具。

```
用户输入 "现在几点了" → 后端始终带工具 → LLM 自动调 current_time → 回复
用户输入 "你好"       → 后端始终带工具 → LLM 判断不需要 → 直接回复
```

前端不需要感知"这轮是 Agent 还是纯聊天"——SSE 事件流中可能出现 ROUND_START/TOOL_START/TOOL_END，也可能不出现。

### 7.2 流消费共用基础设施

不新建独立 composable。在现有 `useChat` 的 `handleSSEEvent` 中新增 Agent 事件分支：

```ts
// 现有 switch 中新增
case SSE_EVENT.ROUND_START:
  chatStore.addAgentRound(payload.round)
  break
case SSE_EVENT.TOOL_START:
  chatStore.addToolCall({ id: payload.toolCallId, name: payload.toolName, args: payload.args, status: 'running' })
  break
case SSE_EVENT.TOOL_END:
  chatStore.completeToolCall(payload.toolCallId, { result: payload.result, status: 'done' })
  break
```

Agent 和 Chat 共用 `streamSessions`、`sendingConvIds`、`switchConversation`、`restoreStreamSession` 全套基础设施。

### 7.3 新增/修改组件

| 组件 | 操作 | 用途 |
|------|:--:|------|
| `ToolCallCard.vue` | 新建 | 工具调用卡片 — running (spinner) / done (结果摘要) / error (红色) |
| `ChatMessage.vue` | 修改 | `role='tool'` 时渲染 ToolCallCard |
| `chat.store.ts` | 修改 | 新增 `agentRounds`、`agentToolCalls` 状态 |

**不改**：`ChatInput.vue`（无需开关）、`app/api/chat.ts`（无需 agentMode 参数）。

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

> **2026-07-30 修正**：原方案有独立 `/api/agent/run` 端点（步骤 7），已合并到步骤 6+8。Agent 开关和前端 `tools` 参数已取消。

| 步骤 | 内容 | 预计 | 依赖 |
|:--:|------|:--:|------|
| 1 | Prompt CRUD | ✅ 已完成 | — |
| 2 | 共享类型扩展 | ✅ 已完成 | — |
| 3 | Prompt Segment 系统 | ⬜ 推迟 | 步骤 2 |
| 4 | 工具系统扩展 | 0.5 天 | 步骤 2 |
| 5 | Provider 升级 + Factory 精简 | ✅ 已完成 | — |
| 6 | Agent Runtime 重写 | 1 天 | 步骤 4, 5 |
| 7 | `/api/chat` 适配 | 0.5 天 | 步骤 6 |
| 8 | Agent UI | 0.5 天 | 步骤 7 |
| 9 | 端到端验证 + 文档 | 0.5 天 | 步骤 8 |

> 总预计：3 天（含已完成的步骤 1、2、5，实际剩余约 2 天工作）

### 12.2 依赖关系图

```
步骤 1: Prompt CRUD ✅ ─────────────────────────────┐
    │ (已完成)                                        │
    │                                                 │
    ▼                                                 │
步骤 2: 共享类型扩展 ✅                               │
    │ (已完成)                                        │
    ▼                                                 │
步骤 4: 工具系统扩展 ──── 步骤 5: Provider ✅ ───────┤
    │ (P0+P1 共 6 个新工具)                           │
    ▼                                                 │
步骤 6: Agent Runtime 重写                            │
    │ (AsyncGenerator + AgentMemory + 并发执行)        │
    ▼                                                 │
步骤 7: /api/chat 适配                                 │
    │ (Agent 流消费分支 + DB 写入策略)                  │
    ▼                                                 │
步骤 8: Agent UI                                       │
    │ (ToolCallCard + useChat + store)                 │
    ▼                                                 │
步骤 9: 端到端验证 + 文档                               │

推迟：
步骤 3: Prompt Segment 系统 → Phase 2 后续
```

### 12.3 当前进度与后续策略

```
已完成的步骤：
✅ 步骤 1: Prompt CRUD（2026-07-26）
✅ 步骤 2: 共享类型扩展（2026-07-29）
✅ 步骤 5: Provider 升级 + Factory 精简（2026-07-26 + 2026-07-29）

当前实施中的步骤：
🔄 步骤 4: 工具系统扩展（P0: web_search + web_fetch）
🔄 步骤 6: Agent Runtime 重写（AsyncGenerator + AgentMemory + 并发执行）

推进策略：
┌─ 阶段 A：工具扩展 + Runner 重写（可并行）─────────────────────┐
│ 步骤 4 → 6                                                      │
│                                                                  │
│ 4. 工具系统扩展 — P0 先做 web_search + web_fetch                │
│    → Brave Search API 申请（免费）→ 配环境变量                   │
│    → 实现 web-search.ts + web-fetch.ts + 注册                    │
│    → P1 工具（date_calculator, unit_converter 等）可穿插进行     │
│                                                                  │
│ 6. Agent Runtime 重写 — 修复所有已知问题                        │
│    → 定义 AgentEvent 类型                                       │
│    → AsyncGenerator<AgentEvent> 模式                            │
│    → AgentMemory 消息裁剪                                        │
│    → Promise.allSettled 并发工具执行                             │
│    → 清理 console.log + 死代码                                   │
│    → ★ Runner 不关心 SSE 编码，只产出结构化事件                  │
│                                                                  │
│ 阶段 A 验证：curl Agent 请求，SSE 流中能看到                     │
│ ROUND_START → TOOL_START → TOOL_END → TEXT → DONE               │
└──────────────────────────────────────────────────────────────────┘

┌─ 阶段 B：/api/chat 串通 + 前端 UI ────────────────────────────┐
│ 步骤 7 → 8                                                      │
│                                                                  │
│ 7. /api/chat 适配                                                │
│    → schema.ts 删除 tools 字段                                  │
│    → shared/types/sse.ts 新增 3 个事件枚举                       │
│    → index.post.ts Agent 流消费分支（for await...of）            │
│    → DB 写入策略：最后一轮增量 + 循环结束批量写 tool 消息        │
│    → ★ 纯聊天回归测试（改动前跑一次基线对话做对比）              │
│                                                                  │
│ 8. Agent UI                                                      │
│    → useChat.ts handleSSEEvent 新增 Agent 事件分支               │
│    → chat.store.ts 新增 agentRounds + agentToolCalls             │
│    → ToolCallCard.vue 组件（running / done / error 三态）        │
│    → ChatMessage.vue role='tool' 渲染                            │
│    → ★ 不改 ChatInput（无需开关）                                │
│                                                                  │
│ 阶段 B 验证：浏览器中发 "算 3×5"，看到工具调用卡片 + 结果。      │
│ 纯聊天行为与改动前完全一致。                                     │
└──────────────────────────────────────────────────────────────────┘
```

### 12.4 各步骤详细说明

#### 步骤 4：工具系统扩展（0.5 天）

**内容**：在现有 calculator + current_time 基础上，新增 6 个工具。

**P0 工具**（需外部服务）：

| 工具 | 依赖 | 备注 |
|------|------|------|
| `web_search` | Brave Search API（免费 2000 次/月） | 需在 nuxt.config.ts 配置 `braveSearchApiKey` |
| `web_fetch` | 无（仅 `fetch()`） | 正则提取 HTML 文本，10s 超时，Edge 兼容 |

**P1 工具**（纯函数，零依赖）：

| 工具 | 参数 | 核心逻辑 |
|------|------|---------|
| `date_calculator` | `date`, `offset`（"+30d""-2w"） | `new Date()` + 正则解析 offset |
| `unit_converter` | `value`, `from`, `to` | 预置换算表查表乘除 |
| `text_stats` | `text` | chars/words/lines/paragraphs 统计 |
| `json_formatter` | `json`, `action`（format/validate/minify） | JSON.parse + JSON.stringify |

**文件**：
```
新建：
  server/service/agent/tools/builtin/web-search.ts
  server/service/agent/tools/builtin/web-fetch.ts
  server/service/agent/tools/builtin/date-calculator.ts
  server/service/agent/tools/builtin/unit-converter.ts
  server/service/agent/tools/builtin/text-stats.ts
  server/service/agent/tools/builtin/json-formatter.ts

修改：
  server/service/agent/tools/index.ts   # 注册新工具
```

**验证**：脚本调用 `webSearch.execute({ query: "今天天气" })` 返回搜索结果。

---

#### 步骤 6：Agent Runtime 重写（1 天）⭐ 核心改动

**内容**：修复 runner.ts 的所有已知问题——非流式、串行执行、无内存管理、debug 代码。

**改动清单**：

| 问题 | 当前 | 修正 |
|------|------|------|
| 返回类型 | `ReadableStream<LLMStreamChunk>` | `AsyncGenerator<AgentEvent>` |
| 最终答案 | `textStream(textParts.join(''))` 一次性 | 检测到无 tool_calls 后 emit text content |
| 工具执行 | `for...of` 串行 | `Promise.allSettled` 并发 |
| 内存管理 | 浅拷贝 | AgentMemory 裁剪（保留 system + 最近 40 条） |
| 取消支持 | 仅循环开头检查 | 传递到工具执行层 |
| 中间轮次 | 不发任何事件 | 发 ROUND_START + TOOL_START/END |

**AgentEvent 类型**：

```ts
type AgentEvent =
  | { type: 'round_start'; round: number }
  | { type: 'tool_start'; toolName: string; toolCallId: string; args: string }
  | { type: 'tool_end'; toolName: string; toolCallId: string; result: string }
  | { type: 'text'; content: string }
  | { type: 'done' }
  | { type: 'error'; message: string }
```

**文件**：
```
新建：
  server/service/agent/types.ts      # AgentEvent 类型
  server/service/agent/memory.ts     # AgentMemory（消息裁剪 + token 估算）

修改：
  server/service/agent/runner.ts     # 重写 — async function* runAgentLoop()
```

**验证**：
- curl 请求 → SSE 流中 ROUND_START → TOOL_START → TOOL_END → TEXT → DONE
- 纯聊天"你好" → LLM 第一轮无 tool_calls → 直接返回文本
- 多工具"算 A 再算 B，再查时间" → 并发执行 → 多轮交互
- 中途 abort → 循环终止，不残留

**代码卫生**：
- 删除 `current-time.ts:25` 的 `console.log`
- 删除 `factory.ts:22-31` 注释掉的 DeepSeek case

---

#### 步骤 7：`/api/chat` 适配（0.5 天）

**内容**：对接新的 Runner，新增 SSE 事件类型，调整 DB 写入策略。

**改动点**：

1. **`shared/types/sse.ts`** — 新增 3 个事件枚举
2. **`server/api/chat/schema.ts`** — 删除 `tools` 字段（前端不再传工具名）
3. **`server/api/chat/index.post.ts`** — Agent 流消费分支

```ts
const toolDefinitions = toolRegistry.getDefinitions()  // 始终全量

if (toolDefinitions.length > 0) {
  // Agent 路径
  const eventStream = runAgentLoop(llmProvider, allMessages, chatOptions)
  for await (const event of eventStream) {
    switch (event.type) {
      case 'round_start': controller.enqueue(ROUND_START); break
      case 'tool_start':  controller.enqueue(TOOL_START); break
      case 'tool_end':    controller.enqueue(TOOL_END); break
      case 'text':        // 最后一轮 → 增量写入 DB
                          contentBuffer += event.content
                          controller.enqueue(TEXT)
                          if (contentBuffer.length - lastFlushLength >= 200) {
                            await updateMessage(...)
                          }
                          break
      case 'error':       controller.enqueue(ERROR); break
      case 'done':        break
    }
  }
} else {
  // 纯聊天路径（零工具注册时）— 现有逻辑不变
}
```

**DB 写入策略**：

| 事件 | 写入方式 |
|------|---------|
| ROUND_START / TOOL_START / TOOL_END | 不写 DB（瞬时状态） |
| TEXT（最后一轮） | 增量写入（每 200 字符 UPDATE） |
| DONE 前 | 批量写入中间轮的 assistant + tool 消息 |

**文件**：
```
修改：
  shared/types/sse.ts               # + ROUND_START, TOOL_START, TOOL_END
  server/api/chat/schema.ts         # 删除 tools 字段
  server/api/chat/index.post.ts     # Agent 流消费分支 + DB 写入策略
```

**验证**：纯聊天回归测试——行为与改动前完全一致。Agent 模式——工具调用正常，刷新后内容不丢。

---

#### 步骤 8：Agent UI（0.5 天）

**内容**：前端对接 Agent SSE 事件，新增 ToolCallCard 组件。不改 ChatInput（无需开关）。

**改动点**：

1. **`useChat.ts`** — `handleSSEEvent` switch 新增 ROUND_START、TOOL_START、TOOL_END
2. **`chat.store.ts`** — 新增 `agentRounds`、`agentToolCalls` 状态
3. **`ToolCallCard.vue`** — 新建，三态：running (spinner) / done (结果) / error (红色)
4. **`ChatMessage.vue`** — `role='tool'` 消息渲染 ToolCallCard

**文件**：
```
新建：
  app/components/agent/ToolCallCard.vue

修改：
  app/composables/useChat.ts             # + Agent SSE 事件处理
  app/stores/chat.store.ts               # + agentRounds, agentToolCalls
  app/components/ChatMessage.vue         # role='tool' 渲染
```

**不改**：
- `ChatInput.vue`（无需 Agent 开关）
- `app/api/chat.ts`（无需 agentMode 参数，无需新建 agent.ts）

**验证**：浏览器中发"算 3×5"，看到工具调用卡片 → 结果。纯聊天行为不变。

---

#### 步骤 9：端到端验证 + 文档（0.5 天）

**验证清单**：

| 场景 | 操作 | 预期 |
|------|------|------|
| 纯聊天回归 | 关闭工具注册，发"你好" | 行为与改动前一致 |
| 单工具 | 发"算 3×5" | ToolCallCard → 结果 15 |
| 多工具并行 | 发"算 A 再算 B，查时间" | 多张 ToolCallCard，并发显示 |
| 工具异常恢复 | 发含有非法字符的算式 | ToolCallCard error → LLM 调整策略 |
| 中途取消 | 工具执行中点停止 | 循环终止，不残留 |
| 多轮交互 | 发需要两轮计算的请求 | ROUND_START 出现两次 |

**文档更新**：
- `roadmap.md`：更新 Phase 2 完成度
- `status.md`：更新进度快照

---

### 12.5 完整文件变更清单

```
新建（8 个）：
├── server/service/agent/types.ts                     # AgentEvent 类型
├── server/service/agent/memory.ts                    # AgentMemory
├── server/service/agent/tools/builtin/web-search.ts  # P0
├── server/service/agent/tools/builtin/web-fetch.ts   # P0
├── server/service/agent/tools/builtin/date-calculator.ts  # P1
├── server/service/agent/tools/builtin/unit-converter.ts   # P1
├── server/service/agent/tools/builtin/text-stats.ts       # P1
├── server/service/agent/tools/builtin/json-formatter.ts   # P1
├── app/components/agent/ToolCallCard.vue             # 前端

修改（7 个）：
├── shared/types/sse.ts                               # + ROUND_START, TOOL_START, TOOL_END
├── server/api/chat/schema.ts                         # 删除 tools 字段
├── server/api/chat/index.post.ts                     # Agent 流消费 + DB 写入策略
├── server/service/agent/runner.ts                    # 重写 — AsyncGenerator
├── server/service/agent/tools/index.ts               # 注册新工具
├── app/composables/useChat.ts                        # + Agent SSE 事件
├── app/stores/chat.store.ts                          # + agentRounds, agentToolCalls
├── app/components/ChatMessage.vue                    # role='tool' 渲染

删除（0 个）：
（仅代码行删除：current-time.ts L25 console.log、schema.ts tools 字段、factory.ts 注释代码）
```

### 12.6 关键风险

| 风险 | 预防措施 |
|------|---------|
| Brave Search API 国内不可用 | 预留 SearXNG / Serper.dev 备用方案 |
| 单轮回复非逐 token 流式 | 短回复（<100 tokens）无感，后续可用 `tee()` 优化 |
| `/api/chat` 改坏 | 改前跑基线对话截图，改后立即对比 |
| web_fetch 目标网站超时 | 10s 超时 + catch → 不阻断 ReAct 循环 |
| AgentMemory 裁剪丢上下文 | 保守裁剪（40 条），观察后再收紧 |
| Cloudflare 100s 超时 | 心跳已覆盖，ReAct 2-3 轮通常 <30s |

