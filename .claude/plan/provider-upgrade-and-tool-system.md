# Provider 升级 + 工具系统 实施方案

> 对应 roadmap 任务：[2.3] Provider 升级（剩余部分）+ [2.2] 内置工具
> 更新于 2026-07-27

---

## 一、背景

当前 `chat()` 返回 `ReadableStream<string>`，工具调用 delta 被显式忽略（`if (!delta?.content) continue`），`tools` 参数未转发给 OpenAI API。本次升级将 `chat()` 返回类型改为 `ReadableStream<LLMStreamChunk>`，实现 tool call delta 累积，同时构建 Tool 基础设施（ToolRegistry + 两个内置工具）。

Provider 精简（删除 Anthropic、Factory 无参化、provider 字段全链路移除）已在 2026-07-26 提前完成，共 21 个文件，净删 259 行。

---

## 二、向后兼容策略

**核心原则**：`chat()` 只返回一种类型（`ReadableStream<LLMStreamChunk>`），不做重载。兼容通过 `filterTextChunks()` 适配器实现——将 `LLMStreamChunk` 流转为纯文本 `ReadableStream<string>`，`/api/chat` 消费端完全无感。

```
旧：llmProvider.chat() → ReadableStream<string> → /api/chat 直接消费
新：llmProvider.chat() → ReadableStream<LLMStreamChunk> → filterTextChunks() → ReadableStream<string> → /api/chat 无改动消费
```

### filterTextChunks 适配器

```ts
// server/utils/stream.ts

export function filterTextChunks(
  source: ReadableStream<LLMStreamChunk>,
): ReadableStream<string> {
  return new ReadableStream({
    async start(controller) {
      const reader = source.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value.type === 'text') {
            controller.enqueue(value.content)
          }
          // tool_calls 和 done chunks 静默忽略
        }
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}
```

`/api/chat` 改动仅 1 行：

```diff
- const llmStream = await llmProvider.chat(allMessages, { ... })
+ const llmStream = filterTextChunks(await llmProvider.chat(allMessages, { ... }))
```

---

## 三、文件变更清单

### 3.1 类型定义（3 个文件修改）

#### `shared/types/provider.ts` — 新增 `LLMStreamChunk`

```ts
// 在现有类型下方新增
export interface LLMStreamTextChunk {
  type: 'text'
  content: string
}

export interface LLMStreamToolCallsChunk {
  type: 'tool_calls'
  toolCalls: ToolCall[]
}

export interface LLMStreamDoneChunk {
  type: 'done'
}

export type LLMStreamChunk = LLMStreamTextChunk | LLMStreamToolCallsChunk | LLMStreamDoneChunk
```

> `ToolCall` 和 `ToolDefinition` 已存在，无需新增。

#### `shared/types/sse.ts` — 新增 `TOOL_CALLS` 事件

```ts
export const SSE_EVENT = {
  META: 'meta',
  TEXT: 'text',
  TOOL_CALLS: 'tool_calls',   // 新增
  DONE: 'done',
  ERROR: 'error',
  PING: 'ping'
} as const
```

#### `server/service/llm/types.ts` — 更新接口签名

```ts
import type { LLMStreamChunk } from '~~/shared/types/provider'

export interface LLMProvider {
  readonly id: string
  chat(messages: Message[], options: ChatOptions): Promise<ReadableStream<LLMStreamChunk>>
  models(): ModelInfo[]
}
```

---

### 3.2 Provider 升级（1 个文件修改）

#### `server/service/llm/openai.ts`

**改动 A**：导入 `LLMStreamChunk`，更新 `chat()` 返回类型。

**改动 B**：转发 `tools` 到 OpenAI API（解决旧代码 `// TODO: tools 支持`）：

```ts
const stream = await this.client.chat.completions.create({
  model: options.model,
  messages: requestMessages,
  stream: true,
  ...(options.temperature !== undefined && { temperature: options.temperature }),
  ...(options.maxTokens !== undefined && { max_tokens: options.maxTokens }),
  ...(options.tools?.length ? {
    tools: options.tools.map(t => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.parameters }
    }))
  } : {}),
})
```

**改动 C**：在 ReadableStream 内部实现 tool call delta 累积——这是整个方案中唯一需要手写的核心逻辑：

```ts
return new ReadableStream<LLMStreamChunk>({
  async start(controller) {
    try {
      // Map<index, { id, name, arguments }> 按 index 聚拢分片到达的 tool call delta
      const toolCallAccum = new Map<number, { id: string; name: string; arguments: string }>()

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta

        // 文本内容 → 即时发出
        if (delta?.content) {
          controller.enqueue({ type: 'text', content: delta.content })
        }

        // 工具调用 delta → 累积（不即时发出，arguments 是不完整 JSON 片段）
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = toolCallAccum.get(tc.index) ?? { id: '', name: '', arguments: '' }
            if (tc.id) existing.id = tc.id
            if (tc.function?.name) existing.name += tc.function.name
            if (tc.function?.arguments) existing.arguments += tc.function.arguments
            toolCallAccum.set(tc.index, existing)
          }
        }
      }

      // 流结束后，一次性发出完整的 tool_calls
      if (toolCallAccum.size > 0) {
        const toolCalls = Array.from(toolCallAccum.values()).map(tc => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments
        }))
        controller.enqueue({ type: 'tool_calls', toolCalls })
      }

      controller.enqueue({ type: 'done' })
      controller.close()
    } catch (error) {
      controller.error(error)
    }
  }
})
```

**设计要点**：
- `id` 用赋值（只在第一个 chunk 出现），`name` 和 `arguments` 用字符串拼接（分片到达）
- `tool_calls` 在流完全结束后一次性发出——arguments 在流中间是不完整的 JSON 片段，Agent Runtime 需要完整的、可 `JSON.parse` 的调用列表
- `Map<number, ...>` 天然支持并行 tool call（不同 index 独立累积）

---

### 3.3 `/api/chat` 适配（1 个文件修改）

#### `server/api/chat/index.post.ts`

改动 2 行：

```ts
import { filterTextChunks } from '~~/server/utils/stream'

// 行 112：包装 LLMStreamChunk → 纯文本流
const llmStream = filterTextChunks(await llmProvider.chat(allMessages, {
  model, tools, systemPrompt, temperature, maxTokens,
  signal: llmAbortController.signal
}))
```

> reader 循环完全不变——`value` 仍是 `string`，`contentBuffer += value` 照旧，DB 增量写入逻辑不动。

---

### 3.4 适配器工具（1 个新文件）

#### `server/utils/stream.ts`

见第二节 `filterTextChunks` 完整代码。

---

### 3.5 Tool 系统（5 个新文件）

```
server/service/agent/tools/
├── types.ts              # ExecutableTool 接口
├── registry.ts           # ToolRegistry 单例
├── index.ts              # 注册入口（import 即注册）
└── builtin/
    ├── calculator.ts     # 数学表达式计算
    └── current-time.ts   # 当前日期时间
```

#### `types.ts` — ExecutableTool 接口

```ts
import type { ToolDefinition } from '~~/shared/types/provider'

export type ToolPermission = 'readonly' | 'readwrite' | 'dangerous'

export interface ExecutableTool {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly permission: ToolPermission
  execute(args: Record<string, unknown>): string | Promise<string>
  toDefinition(): ToolDefinition
}
```

#### `registry.ts` — ToolRegistry

```ts
export class ToolRegistry {
  private tools = new Map<string, ExecutableTool>()

  register(tool: ExecutableTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`工具 "${tool.name}" 已注册`)
    }
    this.tools.set(tool.name, tool)
  }

  get(name: string): ExecutableTool | undefined {
    return this.tools.get(name)
  }

  getDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map(t => t.toDefinition())
  }

  list(): ExecutableTool[] {
    return [...this.tools.values()]
  }
}

export const toolRegistry = new ToolRegistry()
```

#### `builtin/calculator.ts` — 数学表达式计算

- 参数 schema：`{ expression: string }`
- 安全策略：
  - 白名单字符检查：`/^[0-9+\-*/.()%^ eEπPi]+$/`
  - 禁用关键字检测：`constructor`、`__proto__`、`eval`、`Function`、`globalThis`、`window`、`document`、`process`、`require`、`import`、`fetch`
  - 执行隔离：`new Function('"use strict"; return (' + expr + ')')()` — 不暴露全局作用域
- 错误处理：除零、语法错误、超大数字 → 返回友好错误信息
- `permission: 'readonly'`

#### `builtin/current-time.ts` — 当前日期时间

- 参数 schema：`{ format?: 'full' | 'date' | 'time' }`，默认 `'full'`
- 返回格式化后的当前时间字符串（`zh-CN` locale）
- `permission: 'readonly'`

#### `index.ts` — 注册入口

```ts
import { toolRegistry } from './registry'
import { calculatorTool } from './builtin/calculator'
import { currentTimeTool } from './builtin/current-time'

// 模块首次 import 时自动注册
toolRegistry.register(calculatorTool)
toolRegistry.register(currentTimeTool)

export { toolRegistry } from './registry'
export * from './builtin/calculator'
export * from './builtin/current-time'
```

---

## 四、不变更的文件

| 文件 | 原因 |
|------|------|
| `server/service/llm/deepseek.ts` | Provider 精简后已为死代码（学习参考），不修改 |
| `server/service/llm/factory.ts` | 已无参化，无需修改 |
| `shared/types/conversation.ts` | Message 已有 toolCalls/toolCallId 字段 |
| `server/db/schema.ts` | toolCalls/toolCallId 列已存在 |
| `app/composables/useChat.ts` | 暂不改动，Agent UI 阶段再扩展 |
| `app/api/chat.ts` | 前端 API 层无需改动 |

---

## 五、兼容性矩阵

| 维度 | 旧行为 | 新行为 | 兼容性 |
|------|--------|--------|:--:|
| `chat()` 返回类型 | `ReadableStream<string>` | `ReadableStream<LLMStreamChunk>` | ⚠️ 调用方通过适配器透明 |
| `/api/chat` 文本流 | `value` 直接使用 | 适配器还原为 string | ✅ 行为一致 |
| 无 tools 的普通对话 | 纯文本流 | 纯 `text` chunk 流 | ✅ 行为一致 |
| `ChatOptions.tools` | 不转发给 API | 转发给 API | ✅ 增强 |
| `temperature`/`maxTokens` | 已转发 | 保持转发 | ✅ 不变 |

---

## 六、验证方案

### 6.1 TypeScript 类型检查
```bash
npx nuxi typecheck
```
预期：零错误。

### 6.2 纯文本对话回归
```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash","message":[{"role":"user","content":"你好"}]}'
```
预期：SSE 流中仅有 TEXT 事件，与升级前完全一致。

### 6.3 工具调用验证
```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model":"gpt-4o-mini",
    "message":[{"role":"user","content":"计算 123 × 456"}],
    "tools":[{"name":"calculator","description":"计算数学表达式","parameters":{"type":"object","properties":{"expression":{"type":"string","description":"数学表达式"}},"required":["expression"]}}]
  }'
```
预期：如果 LLM 决定调用工具，流末尾出现 `tool_calls` chunk（被 `filterTextChunks` 适配器过滤，不在对客 SSE 中暴露）；如果不调工具，纯文本返回。

### 6.4 ToolRegistry 功能验证
临时脚本（开发环境）：
```ts
import { toolRegistry } from '~~/server/service/agent/tools'

const calc = toolRegistry.get('calculator')
console.log(await calc!.execute({ expression: '2+3*4' }))  // → "14"
console.log(toolRegistry.getDefinitions())                  // → 两个 ToolDefinition
```

### 6.5 浏览器端到端
- 启动 `npx nuxi dev`
- 浏览器中正常聊天 → 流式输出无异常
- 模型切换正常
- 多对话切换正常（后台流保持 + 切回续显）

---

## 七、风险与缓解

| 风险 | 缓解 |
|------|------|
| OpenAI tool call delta index 不连续 | `Map<number, ...>` 天然处理稀疏 index |
| `/api/chat` 改坏 | `filterTextChunks` 对纯文本流是完全透传，改动前跑一次基线对话对比 |
| `deepseek.ts` 不再满足 `LLMProvider` 接口 | 已不在生产路径使用，factory 从不构造它；如需保留 typecheck 通过，可加 `@ts-expect-error` 或删除文件 |
| Edge Runtime 兼容 | 全部使用 `ReadableStream`、`Map` 等标准 ES API，无 Node.js 依赖；OpenAI SDK 已使用 `fetch` |
