# 2026-07-29 — Agent 工具系统实现详解与常见疑点

> 从零理解 Agent 是怎么调用工具的——不只是代码长什么样，而是数据怎么流、LLM 怎么决策、每个字段为什么这么写。

---

## 讨论背景

[2026-07-28 的 P0 分析](./2026-07-28-agent-tool-system-p0-analysis.md) 制定了 Agent ReAct 循环的方案，随后 `runner.ts` 实现完成。但在实际理解和测试中，暴露出大量"代码能跑但不知道为什么能跑"的认知缺口——JSON Schema 为什么能让 LLM 输出标准格式？`description` 注释掉为什么还能工作？`args.timezone` 为什么永远是 `undefined`？

本文以自问自答的方式，逐个击破这些疑点。

---

## 核心内容

### 一、完整链路：从用户输入到工具执行

整个系统涉及 **6 个文件、5 个步骤**：

```
① 工具类定义          ② 注册中心            ③ API 路由
current-time.ts  →  registry.ts  →  chat/index.post.ts
  name: 'current_time'   Map<name, tool>     tools: ['current_time']
  description: '...'     getDefinitions()    → getDefinitions()
  parameters: {...}                          → filter by names
  execute(args) { ... }                      → chatOptions.tools

④ LLM Provider                  ⑤ Agent Runner
openai.ts                    runner.ts
  tools → OpenAI API           for i in 0..10:
  tool call delta 累积           stream = provider.chat()
  → { type: 'tool_calls' }       if tool_calls:
                                    registry.get(name).execute(args)
                                    msgs.push(tool result)
                                    continue
                                  else:
                                    return text
```

#### 步骤 1：工具类定义（[current-time.ts](../../server/service/agent/tools/builtin/current-time.ts)）

```ts
class CurrentTimeTool implements ExecutableTool {
  readonly name = 'current_time'          // 唯一标识
  readonly description = '获取当前日期和时间...' // LLM 据此判断何时用
  readonly parameters = {                 // JSON Schema，告诉 LLM 参数格式
    type: 'object',
    properties: {
      timezone: { type: 'string', description: 'IANA 时区...' }
    }
  }
  execute(args) { /* new Intl.DateTimeFormat(...) */ }  // ⭐ 真正执行的代码
  toDefinition() { return { name, description, parameters } }
}
```

`parameters` 和 `execute()` 在同一个文件里——改参数 Schema 时不可能忘了同步执行逻辑。这是"单一数据源"原则的直接体现。

#### 步骤 2：注册中心（[registry.ts](../../server/service/agent/tools/registry.ts)）

```ts
class ToolRegistry {
  private tools = new Map<string, ExecutableTool>()
  register(tool)    // 存 Map
  get(name)         // 从 Map 取
  getDefinitions()  // 取出所有 toDefinition() → 发给 LLM
}
```

[index.ts](../../server/service/agent/tools/index.ts) 模块首次 import 时自动注册两个内置工具。

#### 步骤 3：API 路由（[chat/index.post.ts](../../server/api/chat/index.post.ts)）

前端现在只传工具名数组（`tools: ['current_time']`），后端从 registry 取定义：

```ts
const toolDefinitions = tools?.length
  ? toolRegistry.getDefinitions().filter(t => tools.includes(t.name))
  : undefined

const rawStream = toolDefinitions?.length
  ? await runAgentLoop(llmProvider, allMessages, chatOptions)
  : await llmProvider.chat(allMessages, chatOptions)
```

这是 **2026-07-29 的改进**：此前前端需要手写完整 `{ name, description, parameters }`，定义在不同地方，极易不一致。现在改为前端只传名字，后端从工具类取定义。

#### 步骤 4：LLM Provider（[openai.ts](../../server/service/llm/openai.ts)）

把 `ToolDefinition[]` 转成 OpenAI API 格式：

```ts
tools: options.tools.map(t => ({
  type: 'function',
  function: { name: t.name, description: t.description, parameters: t.parameters }
}))
```

**🔑 Tool call delta 分片聚拢机制**（[openai.ts:99-128](../../server/service/llm/openai.ts#L99-L128)）

LLM 开启流式模式后，tool call 不是一次性到齐的——OpenAI 的 SSE 协议会把一个完整的 tool call 拆成多次 delta 推送。Provider 需要在内部把这些碎片拼接成完整对象后才交给上层。

**为什么是"分片到达"？**

因为流式模式下，LLM 一边生成一边推送。一个 tool call 的生成顺序天然是 `id` → `name` → `arguments`，每个字段本身也可能跨多个 chunk：

```
chunk 1:  delta.tool_calls = [{ index: 0, id: "call_abc123" }]
chunk 2:  delta.tool_calls = [{ index: 0, function: { name: "current" } }]
chunk 3:  delta.tool_calls = [{ index: 0, function: { name: "_time" } }]
chunk 4:  delta.tool_calls = [{ index: 0, function: { arguments: '{"' } }]
chunk 5:  delta.tool_calls = [{ index: 0, function: { arguments: 'time' } }]
...
chunk N:  delta.tool_calls = [{ index: 0, function: { arguments: '}' } }]
```

其中的 `index` 字段用于区分并行 tool calls（LLM 可能同时决定调两个工具，`index: 0` 和 `index: 1` 各自独立累积）。

**Provider 怎么聚拢？**

核心数据结构是 `Map<index, { id, name, arguments }>`：

```ts
const toolCallAccumulator = new Map<number, { id: string, name: string, arguments: string }>()

for await (const chunk of stream) {
  const delta = chunk.choices?.[0]?.delta

  // 文本 delta → 直接流式发出（不需要聚拢）
  if (delta?.content) {
    controller.enqueue({ type: 'text', content: delta.content })
  }

  // 工具调用 delta → 按 index 累积，不即时发出
  if (delta?.tool_calls) {
    for (const tc of delta.tool_calls) {
      const existing = toolCallAccumulator.get(tc.index) ?? { id: '', name: '', arguments: '' }
      if (tc.id)        existing.id = tc.id              // id 通常一个 chunk 到齐，直接赋值
      if (tc.function?.name)      existing.name += tc.function.name           // name 可能跨多个 chunk，用 += 拼接
      if (tc.function?.arguments) existing.arguments += tc.function.arguments // arguments 一定跨 N 个 chunk，用 += 拼接
      toolCallAccumulator.set(tc.index, existing)
    }
  }
}
```

关键细节：
- **`id` 用 `=`（赋值）**：id 通常一个 chunk 就到齐了
- **`name` 和 `arguments` 用 `+=`（字符串拼接）**：这两个字段几乎一定跨多个 delta 分片到达
- **中途不发出**：arguments 在任何中间状态都是不完整的 JSON 片段，`JSON.parse()` 会报错

**流结束后一把发出：**

```ts
// 循环结束后，所有分片都已到位，一次性转为完整 ToolCall[]
if (toolCallAccumulator.size) {
  const toolCalls = Array.from(toolCallAccumulator.values()).map(tc => ({
    id: tc.id,
    name: tc.name,         // 已拼接完整，如 "current_time"
    arguments: tc.arguments // 已是合法 JSON，如 '{"timezone":"Asia/Shanghai"}'
  }))
  controller.enqueue({ type: 'tool_calls', toolCalls })
}
```

**对比：文本 vs Tool Call 的处理差异**

| | 文本内容 | Tool Call |
|---|---|---|
| 到达方式 | 每 chunk 一个可独立展示的 token | 分片 delta，中途不可用 |
| 发出时机 | 即时逐个发出 | 流结束后一把发出 |
| 数据结构 | `delta.content`（字符串） | `Map<index, {id, name, arguments}>` + 字符串拼接 |

#### 步骤 5：Agent Runner（[runner.ts](../../server/service/agent/runner.ts)）

ReAct 循环核心：

```
for iteration = 0; iteration < 10; iteration++:

  1. provider.chat(conversationMessages, { tools: [...] })
  2. 读取流中所有 chunk → 分离 textParts 和 toolCalls
  3. toolCalls 为空？→ 返回 textParts（循环结束）
  4. 将 assistant 消息（含 toolCalls）写入对话历史
  5. 遍历每个 toolCall：
     tool = toolRegistry.get(tc.name)
     args = JSON.parse(tc.arguments)   // ⭐ Runner 层解析
     result = await tool.execute(args)   // ⭐ 服务器本地执行
     push { role: 'tool', content: result, toolCallId: tc.id }
  6. 回到步骤 1（LLM 现在能看到工具结果）
```

**关键设计**：工具在 Runner 所在服务器上执行（`new Date()`、数学计算等），LLM 完全不知道如何执行——它只负责决策"该调哪个工具"和"传什么参数"。打个比方：LLM 是只会发短信的老板，Runner 是执行命令的秘书。

### 二、工具参数：为什么这么设计

#### JSON Schema 是标准格式，不是项目自创

`parameters` 字段遵循 [JSON Schema](https://json-schema.org/) 规范，被 OpenAI API 直接接受：

```ts
parameters: {
  type: 'object',        // 参数整体是对象
  properties: {          // 描述每个属性
    timezone: {
      type: 'string',    // 属性类型
      description: '...' // 属性含义
    }
  },
  required: ['timezone'] // 哪些必填（可选字段）
}
```

`ToolDefinition = { name, description, parameters }` 这三个字段完全对应 OpenAI Function Calling API 的要求，不是项目自创的结构。

#### `required` 才是 `args.timezone` 为 undefined 的根因

之前的 `current_time` 没有 `required: ['timezone']`，LLM 看到的是"timezone 可选"。当用户问"现在几点了"时，LLM 自然传 `{}`，`execute()` 里 `args.timezone` 就是 `undefined`——这正是设计意图：timezone 不传时使用系统本地时区。

| 用户问 | LLM 传的 args | timezone 值 |
|---|---|---|
| "现在几点了" | `{}` | `undefined`（走 fallback） |
| "纽约现在几点了" | `{"timezone":"America/New_York"}` | `"America/New_York"` |

加上 `required: ['timezone']` 后，LLM 即使听到"现在几点了"也会主动推断时区（或追问用户）。

#### LLM 为什么能生成标准 JSON 格式？

不是魔法，是**专项训练（fine-tuning）**的结果。OpenAI 等厂商在训练模型时，专门喂了海量的 function calling 训练数据——"看到 JSON Schema → 输出符合该 Schema 的 JSON 字符串"。这不是靠通用推理能力硬凑的。

这也解释了为什么 `description` 注释掉后 `timezone` 参数名仍能正常工作——`timezone` 是 LLM 训练语料里出现频率极高的通用词，靠参数名本身就足以推断含义。但如果换一个冷门参数名（如自造的业务术语），去掉 `description` 就会失效。

### 三、2026-07-29 改进：消除重复的工具定义

此前前端请求体中的 `tools` 是完整的对象数组：

```json
// ❌ 改进前：前后端各写一份定义
{ "tools": [{ "name": "current_time", "description": "...", "parameters": {...} }] }
```

现在前端只传工具名：

```json
// ✅ 改进后：前端只做选择
{ "tools": ["current_time"] }
```

后端从 `toolRegistry.getDefinitions()` 取定义。改动涉及 3 个文件：

| 文件 | 改动 |
|---|---|
| [schema.ts](../../server/api/chat/schema.ts) | `tools: z.array(z.object({...}))` → `z.array(z.string())` |
| [index.post.ts](../../server/api/chat/index.post.ts) | 导入 `toolRegistry`，用 `getDefinitions().filter()` 替换透传 |
| [app/api/chat.ts](../../app/api/chat.ts) | `tools?: object[]` → `tools?: string[]` |

### 四、常见疑点速查

| 疑点 | 答案 |
|---|---|
| `args.timezone` 为什么总是 `undefined`？ | 没写 `required: ['timezone']`，LLM 认为可选 → 不传 → `{}`。这是正常的，加了 `required` 后 LLM 才会强制填充 |
| `description` 注释掉为什么还能工作？ | 参数名 `timezone` 是通用词，LLM 训练数据里有。冷门参数名时 `description` 才不可省略 |
| TypeScript `readonly` 和 `permission = 'readonly'` 是两个东西？ | 对。`readonly name` 是 TS 语法（禁止运行时改值），`permission = 'readonly'` 是自定义字符串（安全分级） |
| `toDefinition()` / `getDefinitions()` 为什么有空转感？ | 之前确实空转——只有定义，没人调用。2026-07-29 改进后在 API 路由里接上了 |
| 工具为什么用 class 而不是普通对象？ | `class CurrentTimeTool implements ExecutableTool` → TS 强制执行接口契约，少写一个方法直接红线 |
| LLM 是怎么知道该调哪个工具的？ | 靠 `description` 做语义匹配——跟你看菜单点菜一样，看到"获取当前时间"就知道是这个 |
| 工具的 `arguments` JSON 是谁生成的？ | **LLM 生成的**。LLM 看到 parameters JSON Schema → 自己构造合法的 JSON 字符串 |
| 工具执行是在哪里发生的？ | 在你的服务器上。LLM 只是"决策者"，Runner 拿了 LLM 的指令去本地执行代码 |

### 五、具体例子：消息数组的演变

用户问 "现在几点了？"，tools 含 `current_time`：

```
第 1 轮迭代：
  输入：[user: "现在几点了？"]
  LLM 返回 → tool_calls: [{ id: 'call_1', name: 'current_time', arguments: '{}' }]
  Runner 执行 → currentTimeTool.execute({}) → "2026年7月29日 星期二 15:30 CST"
  消息变为：
    [user]      "现在几点了？"
    [assistant] tool_calls: [{ id: 'call_1', name: 'current_time', arguments: '{}' }]
    [tool]      "2026年7月29日 星期二 15:30 CST" (toolCallId: 'call_1')

第 2 轮迭代：
  输入：上述 3 条消息
  LLM 看到工具结果 → 直接生成文本："现在是 2026 年 7 月 29 日星期二，北京时间 15:30"
  toolCalls 为空 → 循环结束，返回文本
```

---

## 关键洞察

- **`ToolDefinition` 是给 LLM 看的"菜单"，`execute()` 是服务器后厨**——LLM 只点菜不做菜
- **`required` 是 LLM 行为的开关**——不加 `required`，LLM 有权力不传参；加了 `required`，LLM 必须构造参数
- **JSON Schema 是 LLM 和代码之间的唯一契约**——改 `parameters` 必须同步检查 `execute()` 里的取参逻辑
- **前端只传名字、后端取定义**的设计避免了双重维护，新增工具时前端零改动

## 相关文档

- [Agent 工具调用 P0 分析与方案](2026-07-28-agent-tool-system-p0-analysis.md) — 实现前的方案设计
- [ADR-014：Agent 流式 DB 写入策略](../decisions/014-agent-streaming-db-write.md) — 一次性写入的决策理由
- [Phase 2 Agent 系统设计方案](../../.claude/plan/phase2-agent-design.md) — 整体架构决策
- [Provider 升级与工具系统实施方案](../../.claude/plan/provider-upgrade-and-tool-system.md) — Provider 层工具转发
