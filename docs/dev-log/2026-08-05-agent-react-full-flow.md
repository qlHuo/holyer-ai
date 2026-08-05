# 2026-08-05 — Agent ReAct + 工具调用完整流程分析

> 从 API 路由到 LLM 再到前端渲染，逐层追踪数据如何流动——不只是"代码怎么写"，而是"为什么要这样分层"。

---

## 讨论背景

在 2026-07-29 工具系统实现完成后，Runner、Provider、Registry 等组件已能正常工作。但在实际使用中，对"LLM 到底怎么完成一次工具调用"的完整链路仍缺乏一张全景图。本文以一次 `web_search` 调用为例，追踪数据在 6 层架构中的完整流动，并补充此前文档未覆盖的细节（Runner 与 API 路由的职责边界、流式输出的分轮策略、AgentMemory 的作用、并发执行与串行的取舍）。

---

## 核心内容

### 一、架构全景：6 层数据流

```
┌─ ① 前端 UI ───────────────────────────────────────────────────────────┐
│  ChatPanel.vue → useChat() → EventSource                               │
│  按 conversationId 路由 SSE 事件 → 渲染文本/工具卡片                      │
└────────────────────────────────────────────────────────────────────────┘
       ▲ SSE: event: meta / text / round_start / tool_start / tool_end / done / error
       │ 每个事件都带 conversationId（支持多路并行对话）
┌─ ② API 路由层 ─────────────────────────────────────────────────────────┐
│  server/api/chat/index.post.ts                                         │
│  职责：拼装上下文 → 创建 Provider → 调用 runAgentLoop()                  │
│        → AgentEvent 逐一映射为 SSE 事件 → 增量写 DB                      │
│  不负责：工具定义注入（由 Runner 自己做）、ReAct 循环控制                  │
└────────────────────────────────────────────────────────────────────────┘
       │ AsyncGenerator<AgentEvent>  — for await...of
       ▼
┌─ ③ ReAct Runner ───────────────────────────────────────────────────────┐
│  server/service/agent/runner.ts                                        │
│  职责：while (轮次 ≤ 10) { LLM调用 → 读流 → 有 tool? 执行 : 结束 }      │
│  自注入 tools 定义、并发执行工具、管理 AgentMemory                       │
│  产出：round_start / tool_start / tool_end / text / done / error        │
└────────────────────────────────────────────────────────────────────────┘
       │ ① toolRegistry.getDefinitions() → tools[]
       │ ② provider.chat(messages, { tools })
       ▼
┌─ ④ LLM Provider ───────────────────────────────────────────────────────┐
│  server/service/llm/openai.ts                                          │
│  职责：内部消息格式 → OpenAI API 格式（含 tool_calls 回译）              │
│        tool call delta 跨 chunk 聚拢后一把发出                          │
│  输出：ReadableStream<LLMStreamChunk>                                   │
└────────────────────────────────────────────────────────────────────────┘
       │ HTTP POST (SSE) → OpenAI 兼容 API
       ▼
┌─ ⑤ LLM API ───────────────────────────────────────────────────────────┐
│  收到 tools 定义 → 自主决策 → 流式返回文本 or tool_calls                 │
└────────────────────────────────────────────────────────────────────────┘
       │ 当 LLM 返回 tool_calls 时
       ▼
┌─ ⑥ ToolRegistry ───────────────────────────────────────────────────────┐
│  toolRegistry.get(name) → ExecutableTool → tool.execute(args)          │
│  结果以 tool role 消息写回 AgentMemory → 下一轮 LLM 看到结果后决定下一步  │
└────────────────────────────────────────────────────────────────────────┘
```

---

### 二、逐层追踪（以 "搜索 TypeScript 5.8 新特性" 为例）

#### 第 1 层：API 路由 — 分流决策

[api/chat/index.post.ts:114-146](https://github.com/holyer-ai/holyer-ai/blob/main/server/api/chat/index.post.ts#L114-L146)

```ts
const toolDefinitions = toolRegistry.getDefinitions()
// → [{ name: 'web_search', description: '...', parameters: {...} }, ...]

if (toolDefinitions.length > 0) {
  // ─── Agent 路径 ───
  const eventStream = runAgentLoop(llmProvider, allMessages, chatOptions)
  for await (const event of eventStream) { /* 转 SSE */ }
} else {
  // ─── 纯聊天路径 ───
  const rawStream = await llmProvider.chat(allMessages, chatOptions)
  // 直接读文本流，无 ReAct 循环
}
```

**关键细节**：`chatOptions` **不含 tools**。工具定义不由 API 路由传入——Runner 内部自己调用 `toolRegistry.getDefinitions()`。API 路由的角色是"调度者"：有工具 → 走 Agent 路径；无工具 → 走纯聊天路径。

另外，有工具时 API 路由会向 system prompt 追加**工具调用准则**（[第 122-131 行](https://github.com/holyer-ai/holyer-ai/blob/main/server/api/chat/index.post.ts#L122-L131)）：

```ts
const toolUsageGuidelines = `## 工具调用准则

你可以使用工具来辅助回答问题。遵守以下规则：
- 只有问题涉及实时信息、具体计算、日期时间或需要获取特定网页内容时才调用工具
- 日常问候、闲聊、常识性问题不要调用工具，直接回答即可
- 如果不确定是否需要工具，就不要调用——先尝试直接回答`
```

这是为了防止 LLM 对"你好"也调用 `web_search`。

#### 第 2 层：ReAct Runner — 核心循环

[runner.ts:39-185](https://github.com/holyer-ai/holyer-ai/blob/main/server/service/agent/runner.ts#L39-L185)

Runner 是整条链路的心脏。每个轮次分 6 个步骤：

```
               ┌──────────────────────────┐
               │   初始化 AgentMemory       │
               │   自动分离 system 消息      │
               └────────────┬─────────────┘
                            │
               ┌────────────▼─────────────┐
               │  for round = 1..10       │
               │                          │
               │  ① provider.chat(        │
               │       memory.getAll(),   │ ← 每轮带全量工具定义
               │       { tools: registry  │   LLM 自行判断要不要用
               │         .getDefinitions()│
               │     })                   │
               │         │                │
               │  ② reader.read() 逐 chunk│
               │     text → 条件流式发出   │ ← 无 tool_calls 时才 emit
               │     tool_calls → 累积    │
               │         │                │
               │  ③ tool_calls 数量 > 0?  │
               │     │YES         │NO     │
               │     ▼            ▼       │
               │  中间轮         最终轮    │
               │  • round_start  • text   │
               │  • tool_start    (已流式  │
               │  • 并发执行      发出)    │
               │  • tool_end     • done   │
               │  • 结果写回      • return │
               │    memory                 │
               │  • → 下一轮               │
               └──────────────────────────┘
```

##### 步骤 ①：发起 LLM 调用（Runner 自注入工具）

[runner.ts:54-57](https://github.com/holyer-ai/holyer-ai/blob/main/server/service/agent/runner.ts#L54-L57)

```ts
const stream = await provider.chat(memory.getAll(), {
  ...options,                          // chatOptions（model, temperature, signal...）
  tools: toolRegistry.getDefinitions() // ← Runner 自己注入！
})
```

**为什么是 Runner 注入而不是 API 路由？** 因为 API 路由只管"有没有工具来决定走哪条路径"，Runner 才是真正跟 LLM 对话的组件。每轮 LLM 调用都需要带上全量工具定义——即使上一轮已经调过工具了，下一轮 LLM 仍然可能再次调用（链式工具调用）。

##### 步骤 ②：读取 LLM 响应流

[runner.ts:62-88](https://github.com/holyer-ai/holyer-ai/blob/main/server/service/agent/runner.ts#L62-L88)

```ts
const textParts: string[] = []
const toolCalls: ToolCall[] = []

while (true) {
  const { done, value } = await reader.read()
  if (done) break

  if (value.type === 'text') {
    textParts.push(value.content)
    // 关键：只在 tool_calls 还没出现时才流式发出文本
    if (toolCalls.length === 0) {
      yield { type: 'text', content: value.content }
    }
  } else if (value.type === 'tool_calls') {
    toolCalls.push(...value.toolCalls)
  }
}
```

**关键策略 — 分轮流式输出**：
- **中间轮**（有 tool_calls）：文本**不流式发出**（LLM 可能在 tool_calls 前输出简短引导语如"我来搜索一下"，这些不应展示给用户）
- **最终轮**（无 tool_calls）：文本**逐 chunk 流式发出**（给用户看的最终回复）

这就是为什么你在 UI 上看到的是：工具调用过程（卡片式指示器）→ 然后才开始流式输出文本。

##### 步骤 ③：分流 — 最终轮 vs 中间轮

[runner.ts:93-96](https://github.com/holyer-ai/holyer-ai/blob/main/server/service/agent/runner.ts#L93-L96)

```ts
if (toolCalls.length === 0) {
  yield { type: 'done' }
  return  // ← Runner 结束
}
```

最终轮：文本已在步骤 ② 逐 chunk 流式发出，只需发出 `done` 事件。

##### 步骤 ④⑤：并发执行工具 + 结果写回

[runner.ts:100-178](https://github.com/holyer-ai/holyer-ai/blob/main/server/service/agent/runner.ts#L100-L178)

```ts
// 写入 assistant 消息（含 tool_calls）
memory.add({ role: 'assistant', content: assistantContent, toolCalls })

// 先发出所有 tool_start
for (const tc of toolCalls) {
  yield { type: 'tool_start', toolCallId: tc.id, toolName: tc.name, arguments: tc.arguments }
}

// 并发执行所有工具
const settled = await Promise.allSettled(
  toolCalls.map(async (tc) => {
    const tool = toolRegistry.get(tc.name)   // 从注册表查找
    const args = JSON.parse(tc.arguments)     // LLM 给的 JSON → 对象
    const result = await tool.execute(args)   // 真正干活
    return { toolCallId: tc.id, toolName: tc.name, success: true, result }
  })
)

// 发出 tool_end + 写入 tool 消息
for (const item of settled) {
  yield { type: 'tool_end', toolCallId, toolName, success, result }
  memory.add({ role: 'tool', content: result, toolCallId })
}
```

**为什么是 `Promise.allSettled` 并发而非串行？** 同一轮内 LLM 可能同时返回多个 tool_calls（如同时调 `web_search` + `current_time`），二者之间没有依赖关系，并发执行能减少总等待时间。使用 `allSettled`（而非 `all`）确保一个工具失败不会阻塞其他工具。

##### 步骤 ⑥：下一轮 — AgentMemory 的内容

第 1 轮结束后，AgentMemory 中的消息变为：

```
[system]   "你是 helpful assistant...\n## 工具调用准则\n..."
[user]     "搜索 TypeScript 5.8 新特性"
[assistant] ""  + tool_calls: [{ id: "call_1", name: "web_search", arguments: '{"query":"..."}' }]
[tool]     "📌 AI摘要：TypeScript 5.8 新增了..."  (toolCallId: "call_1")
```

第 2 轮 LLM 收到这些消息后，看到搜索结果，决定直接生成最终回复——不再返回 tool_calls。Runner 检测到 `toolCalls.length === 0`，流式发出文本后返回 `done`。

---

### 三、Provider 层：工具定义如何传给 LLM

[openai.ts:78-93](https://github.com/holyer-ai/holyer-ai/blob/main/server/service/llm/openai.ts#L78-L93)

```ts
// ToolDefinition[] → OpenAI function calling 格式
...(options.tools?.length
  ? {
      tools: options.tools.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters  // JSON Schema
        }
      }))
    }
  : {})
```

#### 补充：assistant 消息的回译

当对话历史中有 tool_calls 时，Provider 需要把内部格式回译成 OpenAI API 格式（[openai.ts:48-60](https://github.com/holyer-ai/holyer-ai/blob/main/server/service/llm/openai.ts#L48-L60)）：

```ts
case 'assistant':
  if (msg.toolCalls?.length) {
    requestMessages.push({
      role: 'assistant',
      content: msg.content || null,
      tool_calls: msg.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments }
      }))
    })
  }
```

**为什么 content 可以是 null？** 当 LLM 决定调工具时，OpenAI API 要求 assistant 消息的 `content` 为 `null`（而非空字符串），表示"这一轮没有文本输出"。内部用空字符串 `''` 存储以简化类型，Provider 层负责做 `|| null` 转换。

同理，tool 结果消息需要带 `tool_call_id` 关联（[openai.ts:68-73](https://github.com/holyer-ai/holyer-ai/blob/main/server/service/llm/openai.ts#L68-L73)）：

```ts
case 'tool':
  requestMessages.push({
    role: 'tool',
    tool_call_id: msg.toolCallId!,
    content: msg.content
  })
```

---

### 四、数据格式对照：喂给 LLM 的 vs 项目内部的

| 概念 | 项目内部类型 | OpenAI API 格式 | 说明 |
|------|-------------|----------------|------|
| 工具定义 | `ToolDefinition` (name, description, parameters) | `{ type: "function", function: {...} }` | Provider 层做转换 |
| 工具调用 | `ToolCall` (id, name, arguments) | `tool_calls[{ id, type, function: {name, arguments} }]` | arguments 是 JSON 字符串 |
| assistant 消息 | `Message { role, content, toolCalls }` | `{ role: "assistant", content: null, tool_calls }` | content 空串 → null |
| tool 结果 | `Message { role, content, toolCallId }` | `{ role: "tool", tool_call_id, content }` | toolCallId 关联回 assistant |

**`permission` 字段不传给 LLM**。它是项目级概念，只给前端 UI 显示用（区分 readonly / readwrite / dangerous）。`toDefinition()` 只输出 `{ name, description, parameters }`——不含 permission。

---

### 五、AgentMemory：消息裁剪

[memory.ts](https://github.com/holyer-ai/holyer-ai/blob/main/server/service/agent/memory.ts)

AgentMemory 在构造函数中自动分离 system 消息，然后维护一个消息列表。核心能力是**裁剪**——保留 `system + 最近 40 条`消息，防止上下文超长。关键约束：**不拆散 tool call 配对**（assistant + tool 消息成对保留或一起裁剪）。

---

### 六、SSE 事件映射：AgentEvent → 前端

[api/chat/index.post.ts:148-206](https://github.com/holyer-ai/holyer-ai/blob/main/server/api/chat/index.post.ts#L148-L206)

| AgentEvent | SSE event type | 携带数据 | 前端行为 |
|------------|---------------|---------|---------|
| `round_start` | `round_start` | round 序号 | 前端可展示"第 N 轮思考" |
| `tool_start` | `tool_start` | toolCallId, toolName, args | 渲染工具调用卡片（执行中态） |
| `tool_end` | `tool_end` | toolCallId, toolName, result, success | 更新卡片为完成/失败态 |
| `text` | `text` | content | 流式追加文本 + 增量写 DB（每 200 字符） |
| `done` | `done` | — | 标记流结束 |
| `error` | `error` | message | 展示错误提示 |

**增量写 DB 策略**（[api/chat/index.post.ts:189-192](https://github.com/holyer-ai/holyer-ai/blob/main/server/api/chat/index.post.ts#L189-L192)）：

```ts
if (contentBuffer.length - lastFlushLength >= 200) {
  await updateMessage(newMsg.id, { content: contentBuffer })
  lastFlushLength = contentBuffer.length
}
```

每 200 字符写一次 DB，流结束后最终保存。这样即使中途连接断开，已接收的内容也不会丢失。

---

### 七、纯聊天路径 vs Agent 路径

| 维度 | 纯聊天路径 | Agent 路径 |
|------|-----------|-----------|
| 触发条件 | `toolDefinitions.length === 0` | `toolDefinitions.length > 0` |
| LLM 调用次数 | 1 次 | 1~10 次（ReAct 循环） |
| 流式文本 | 全程流式 | 仅最终轮流式，中间轮文本不发出 |
| 工具执行 | 无 | 并发执行，结果喂回 LLM |
| 输出格式 | `ReadableStream<string>` | `AsyncGenerator<AgentEvent>` |
| DB 写入 | 增量（每 200 字符） | 增量（同左） |

---

### 八、完整工具调用实例（时序）

用户问"搜索 TypeScript 5.8 新特性"的完整时序：

```
时间 →

API 路由:  分流 → Agent 路径 → runAgentLoop() → for await event
                │
Runner:         ├─ 轮次 1 ──────────────────────────────────────
                │  ① provider.chat(messages, { tools: [...] })
                │  ② LLM 返回: tool_calls [{ web_search, query="TS 5.8" }]
                │  ③ 中间轮 → yield round_start
                │  ④ yield tool_start (web_search)
                │  ⑤ toolRegistry.get("web_search").execute({query:"TS 5.8"})
                │     → fetch Tavily API → "📌 AI摘要：TS 5.8 新增..."
                │  ⑥ yield tool_end (success, result)
                │  ⑦ memory.add({role:"tool", content:"📌 AI摘要..."})
                │
                ├─ 轮次 2 ──────────────────────────────────────
                │  ① provider.chat(memory.getAll(), ...)
                │     memory 现在包含 tool 结果消息
                │  ② LLM 看到结果 → 不调工具 → 流式返回最终文本
                │  ③ 最终轮 → yield text chunk × N (流式)
                │  ④ yield done → return
                │
API 路由:   text → SSE text × N (前端逐字渲染)
            tool_start → SSE tool_start (前端渲染工具卡片)
            tool_end → SSE tool_end (前端更新卡片状态)
            done → SSE done (前端标记完成)
            → updateMessage (最终保存到 DB)
```

---

## 关键洞察

- **Runner 和 API 路由的职责边界**：API 路由是"调度者"（Agent 路径 vs 纯聊天），Runner 是"执行者"（ReAct 循环 + 工具注入 + 工具调度）。工具定义由 Runner 自己注入，不是 API 路由传的
- **流式输出的分轮策略是刻意设计**：中间轮不发出文本（LLM 可能在 tool_calls 前输出引导语），最终轮才流式输出。这不是技术限制，是为了用户体验——用户不需要看到"我来搜索一下"这种中间态文本
- **`Promise.allSettled` 并发是关键性能优化**：同一轮多个无依赖的工具调用并发执行，总耗时 = max(各工具耗时) 而非 sum
- **`LLMStreamChunk` 统一了文本和 tool_calls**：Provider 层对上层屏蔽了"tool call 是分片到达"的复杂性。上层只需判断 `chunk.type === 'text'` 还是 `chunk.type === 'tool_calls'`
- **permission 是项目概念，不传给 LLM**：`toDefinition()` 只输出 `{ name, description, parameters }`，permission 仅用于前端 UI 的安全分级展示

## 相关文档

- [Agent 工具系统实现详解](2026-07-29-agent-tool-system-implementation.md) — 实现细节、JSON Schema 设计、tool call delta 聚拢
- [Agent 工具调用 P0 分析](2026-07-28-agent-tool-system-p0-analysis.md) — 实现前的方案设计
- [Agent 工具调用指示器设计 V3](2026-08-03-agent-toolcall-ui-redesign.md) — 前端 UI 卡片式工具调用
- [Phase 2 Agent 系统设计方案](../../.claude/plan/phase2-agent-design.md) — 整体架构决策
- [ADR-012：LLMStreamChunk 类型升级](../decisions/012-llm-stream-chunk-type.md) — `chat()` 返回类型从 `string` 升级为 `LLMStreamChunk`
- [ADR-014：Agent 流式 DB 写入策略](../decisions/014-agent-streaming-db-write.md) — 增量写入的决策理由
- [LLM Provider 开发规则](../../.claude/rules/llm-provider.md) — tool call delta 聚拢模式
