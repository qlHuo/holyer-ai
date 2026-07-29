# Agent 工具调用系统 P0 分析与方案

> 2026-07-28 · 工具定义层与 Provider 层已完成，本文聚焦当前缺口与立即修复方案
> 
> ⚡ **2026-07-29 更新**：本文方案已实施完毕，详细实现分析见 [Agent 工具系统实现详解](2026-07-29-agent-tool-system-implementation.md)。

---

## 一、当前实现全景

| 层 | 文件 | 状态 |
|------|------|:--:|
| 类型定义 | `shared/types/provider.ts` — `ToolDefinition`, `ToolCall`, `LLMStreamChunk` | ✅ |
| 工具接口 | `server/service/agent/tools/types.ts` — `ExecutableTool` | ✅ |
| 注册中心 | `server/service/agent/tools/registry.ts` — `ToolRegistry` | ✅ |
| 内置工具 | `builtin/calculator.ts` + `builtin/current-time.ts` | ✅ |
| Provider 转发 | `server/service/llm/openai.ts` — tool call delta 累积 + 转发 OpenAI API | ✅ |
| 向 `/api/chat` 输出 | `filterTextChunks()` 剥离 tool_calls，仅传递纯文本 | ⚠️ |

**结论**：工具的定义、注册、LLM 侧调用能力已就绪，但工具的执行和循环回传缺失。

---

## 二、P0 问题

### P0-1：缺少 Agent Runtime（执行循环）

**现状**：[`server/api/chat/index.post.ts:113`](../../server/api/chat/index.post.ts#L113) 调用 `filterTextChunks()`，tool_calls chunk 被静默丢弃（注释：`// tool_calls 暂不处理`）。

**问题链路**：

```
用户提问 "计算 123×456"
  → LLM 决定调用 calculator 工具
  → openai.ts 累积 tool call delta，发 {type: 'tool_calls', toolCalls: [...]}
  → filterTextChunks 看到 type !== 'text' → 丢弃
  → 用户收不到任何有效回复
```

**缺失组件**：

1. **Agent 循环** — LLM 返回 tool_calls → 查 ToolRegistry → execute → 结果塞回消息 → 再调 LLM → 直到不再调工具
2. **最大迭代限制** — 防止无限循环
3. **消息历史管理** — 将 assistant(tool_calls) + tool results 正确插入消息序列

### P0-2：`ToolCall.arguments` 类型不匹配

**[`server/service/llm/openai.ts:108`](../../server/service/llm/openai.ts#L108)**：

```ts
// 当前（错误）
arguments: JSON.parse(tc.arguments)  // string → object，但 ToolCall.arguments 类型是 string

// 应有
arguments: tc.arguments              // 保持 string，由 Agent Runtime 在 execute 时 JSON.parse
```

[`shared/types/provider.ts:37`](../../shared/types/provider.ts#L37) 定义 `arguments: string`。OpenAI API 返回的 arguments 是 JSON 字符串，应原样保留。

---

## 三、方案设计

### 设计决策：工具执行粒度

**选择"仅最终答案"模式** — 工具执行在服务端静默完成，只向客户端流式输出最终文本回复。

理由：对 `/api/chat` 改动最小（仅加一个条件分支），前端无需任何改动，可立即通过 curl 或浏览器验证。

### 核心架构

```
                        ┌──────────────────────────────────┐
                        │        /api/chat/index.post.ts   │
                        │                                  │
   hasTools? ──Yes──→   │  runAgentLoop(provider, msgs,    │
                        │    {model, tools, ...})           │
                        │       │                          │
                        │       ↓                          │
                        │  ┌─────────────────────┐         │
                        │  │ Agent Loop (runner) │         │
                        │  │                     │         │
                        │  │ for i in 0..10:     │         │
                        │  │   stream = provider  │         │
                        │  │     .chat(msgs)     │         │
                        │  │   chunks = readAll  │         │
                        │  │   if tool_calls:    │         │
                        │  │     for each tc:    │         │
                        │  │       tool = reg    │         │
                        │  │         .get(name)  │         │
                        │  │       result = tool │         │
                        │  │         .execute()  │         │
                        │  │       msgs.push(    │         │
                        │  │         tool_msg)   │         │
                        │  │     continue        │         │
                        │  │   else:             │         │
                        │  │     return stream   │         │
                        │  └─────────────────────┘         │
                        │       │                          │
                        │       ↓                          │
   hasTools? ──No──→    │  provider.chat(msgs)             │
                        │       │                          │
                        │       ↓                          │
                        │  filterTextChunks(rawStream)     │
                        │       │                          │
                        │       ↓                          │
                        │  SSE reader → enqueue TEXT/DONE  │
                        └──────────────────────────────────┘
```

两种路径汇合于 `filterTextChunks` → reader 循环 → SSE 发送。后续的 DB 增量写入、SSE 事件发送逻辑完全不变。

### 文件变更清单

#### 1. 修复 `server/service/llm/openai.ts`（1 行）

```diff
- arguments: JSON.parse(tc.arguments)
+ arguments: tc.arguments
```

#### 2. 新增 `server/service/agent/runner.ts`

核心函数签名：

```ts
export async function runAgentLoop(
  provider: LLMProvider,
  messages: Message[],
  options: ChatOptions & { signal?: AbortSignal },
): Promise<ReadableStream<LLMStreamChunk>>
```

内部逻辑：

```
1. 深拷贝 messages → conversationMessages
2. for i in 0..MAX_ITERATIONS (10):
   a. 检查 signal.aborted → 抛 AbortError
   b. provider.chat(conversationMessages, options)
   c. readAllChunks(stream):
      - text → 累积到 textParts[]
      - tool_calls → 记录到 toolCalls[]
      - done → 忽略
   d. 如果 toolCalls 为空 → 返回合成 stream({type:'text', textParts.join}), {type:'done'})
   e. 将 assistant 消息（含 toolCalls）推入 conversationMessages
   f. 对每个 toolCall:
      - toolRegistry.get(tc.name)
      - 未找到 → result = "Error: 工具未注册"
      - 找到 → JSON.parse(tc.arguments) → tool.execute(args)
      - 执行异常 → result = "工具执行出错: ..."
      - 推入 conversationMessages({role:'tool', content: result, toolCallId: tc.id})
3. 超限 → 返回错误提示流
```

关键设计：
- 返回 `ReadableStream<LLMStreamChunk>`（与 `provider.chat()` 同类型），`filterTextChunks` 兼容
- `arguments` 在此层 `JSON.parse`（不污染 Provider 层的类型契约）
- 工具异常以字符串形式返回给 LLM，LLM 可据此重试或告知用户
- 最终答案是非流式的（整个 text 一次性发出），这是当前实现的一个已知让步（见 [ADR-014](../../.claude/plan/phase2-agent-design.md)）

#### 3. 修改 `server/api/chat/index.post.ts`（~6 行）

```diff
+ import { runAgentLoop } from '~~/server/service/agent/runner'

  const llmStream = filterTextChunks(
-   await llmProvider.chat(allMessages, {
-     model, tools, systemPrompt, temperature, maxTokens,
-     signal: llmAbortController.signal,
-   })
+   await (tools && tools.length > 0
+     ? runAgentLoop(llmProvider, allMessages, { model, tools, systemPrompt, temperature, maxTokens, signal: llmAbortController.signal })
+     : llmProvider.chat(allMessages, { model, tools, systemPrompt, temperature, maxTokens, signal: llmAbortController.signal })
+   )
  )
```

`tools` 为空时走原路径（零开销）。reader 循环、DB 写入、SSE 发送全不动。

### 不变更的文件

| 文件 | 原因 |
|------|------|
| `server/service/agent/tools/*` | 工具实现无需修改 |
| `server/utils/stream.ts` | `filterTextChunks` 继续使用 |
| `server/utils/sse.ts` | SSE 包装层不受影响 |
| `app/` 下所有文件 | 前端暂不改动，Phase 2 后续再做 ToolCallCard |

---

## 四、验证方案

### 4.1 TypeScript 类型检查

```bash
npx nuxi typecheck
```

### 4.2 纯文本对话回归（无 tools）

```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash","message":[{"role":"user","content":"你好，1+1等于几？"}]}'
```

预期：正常流式返回文本，与修复前行为一致。

### 4.3 单工具调用（calculator）

```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model":"deepseek-v4-flash",
    "message":[{"role":"user","content":"帮我计算 123 × 456 + 789"}],
    "tools":[{
      "name":"calculator",
      "description":"执行数学计算。输入数学表达式字符串，返回计算结果。",
      "parameters":{"type":"object","properties":{"expression":{"type":"string","description":"数学表达式"}},"required":["expression"]}
    }]
  }'
```

预期：LLM 调用 calculator 工具，Agent 循环执行并返回最终计算结果（纯文本）。

### 4.4 单工具调用（current_time）

```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model":"deepseek-v4-flash",
    "message":[{"role":"user","content":"现在几点了？"}],
    "tools":[{
      "name":"current_time",
      "description":"获取当前日期和时间",
      "parameters":{"type":"object","properties":{"timezone":{"type":"string","description":"时区"}}}
    }]
  }'
```

### 4.5 多轮工具调用

```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model":"deepseek-v4-flash",
    "message":[{"role":"user","content":"计算 (100+200)*3 和 2024除以4，然后告诉我哪个更大"}],
    "tools":[{
      "name":"calculator",
      "description":"执行数学计算",
      "parameters":{"type":"object","properties":{"expression":{"type":"string"}},"required":["expression"]}
    }]
  }'
```

预期：LLM 可能多次调用 calculator（每道题一次），Agent 循环自动处理多次迭代。

### 4.6 浏览器端到端

- `npx nuxi dev` → 浏览器正常聊天 → 模型切换正常 → 多对话切换正常
- 带 tools 的对话（虽然前端不传 tools，但回归验证原有路径不受影响）

---

## 五、已知让步

| 让步 | 影响 | 后续处理 |
|------|------|---------|
| 最终答案非流式 | 长回答一次性出现，无逐字动画 | Phase 2 后续优化：agent 最后一轮直接 pipe 原始流 |
| 工具调用过程对前端不可见 | 用户不知道 AI 在"思考"还是"调工具" | Phase 2 后续：新增 SSE 事件类型 + ToolCallCard UI |
| 无 Abort 信号对 agent 循环内单次 LLM 调用的传递 | 用户取消后当前正在执行的 LLM 调用可能继续 | 已通过 `signal?.aborted` 检查缓解，非完美 |
