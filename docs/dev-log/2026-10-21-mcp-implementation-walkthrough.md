# 2026-10-21 — MCP 接入实现全链路解读

> 一句话总结：MCP 工具在**装配阶段**被翻译成项目内部的 `ExecutableTool`，之后完全复用现有 Agent 工具链。模型调用时只触发 `tools/call`，不会重新触发 `tools/list`。

---

## 背景

4A.0（PromptSegment）、4A.1（MCP Client）、4A.2（工具适配 + 请求级注册表）完成后，需要把"到底实现了什么、一次请求怎么流动"串成完整认知。

本文回答两个问题：

1. 当前 MCP 接入包含哪些模块，各自负责什么？
2. 从浏览器发一条消息到最终回答，数据经过哪些边界、被谁转换成什么形状？

---

## 一、一句话概括

> 连上 MCP Server → 发现工具 → 包装成 `ExecutableTool` → 注入模型 → 模型调用时转发回 MCP Server → 结果作为工具结果回填。

目前已经能与内置工具（calculator / web_search）共存；**尚未做 DB 持久化与管理界面**。

---

## 二、全景图

```
                    ┌──────────────────────────────────────────┐
                    │ server/service/mcp/                      │
                    │                                          │
 配置来源            │  servers.ts    ── 读取配置、组装工具     │
 (当前 .env)         │       │                                  │
                    │       ▼                                  │
                    │  client.ts     ── 说 MCP 协议            │
                    │       │                                  │
                    │       ▼                                  │
                    │  tool-adapter.ts ── 翻译成 ExecutableTool│
                    └───────┬──────────────────────────────────┘
                            │
                            ▼
              server/service/agent/tools/
                createToolRegistry()  ← 内置工具 + MCP 工具
                            │
                            ▼
              server/service/agent/runner.ts
                ReAct 循环（完全不感知 MCP）
                            │
                            ▼
                     LLM Provider → 模型
```

`probe.ts` 是另一条支线：给未来的管理页"测试连接"用，对话链路不经过它。

---

## 三、完整链路

### 第 0 步：前端发起请求

```
POST /api/chat
body: {
  model: "deepseek-v4-pro",
  message: [{ role: "user", content: "请调用 weather__get_weather 查询上海天气" }],
  conversationId: null
}
```

### 第 1 步：路由做请求级准备

[server/api/chat/index.post.ts](../../server/api/chat/index.post.ts)

```
defineEventHandler
  ├─ 1. ChatBodySchema.parse(body)                Zod 校验
  ├─ 2. getOrCreateConversation()                 建会话 / 读历史
  ├─ 3. addMessages()                             用户消息落库
  ├─ 4. allMessages = 历史 + 当前消息              组装上下文
  ├─ 5. createLLMProvider()                       创建 Provider
  └─ 6. new ReadableStream({ start })             SSE 流开始
```

到此为止还没有任何 MCP 参与。

### 第 2 步：装配工具（模型决策之前）

#### 2.1 读取配置

```ts
const mcpTools = await loadMcpTools(signal)
```

进入 [server/service/mcp/servers.ts](../../server/service/mcp/servers.ts)：

```
loadMcpTools(signal)
  ├─ getEnabledMcpServers()
  │    ├─ 仅开发环境：读取 NUXT_MCP_DEV_SERVERS（M3 改为 DB）
  │    ├─ normalizeServer → McpServerConfig[]
  │    └─ 过滤 enabled=false
  │
  └─ for (server of servers)
       ├─ const client = new McpClient({ url, headers })
       ├─ snapshots = server.tools.filter(未在 disabledTools 中)
       ├─ if (snapshots.length === 0)
       │    └─ snapshots = await client.listTools(signal)
       └─ tools.push(...createMcpTools(server, snapshots, client))
```

**关键衔接点**：`McpClient` 在这里创建，随后被 `createMcpTools` 闭包捕获。同一个实例先负责 `tools/list`，之后负责 `tools/call`，所以协议协商结果（modern / legacy、session）在本次请求内复用。

#### 2.2 `listTools()`：协商 + 拉取工具

[server/service/mcp/client.ts](../../server/service/mcp/client.ts)

```
listTools(signal)
  ├─ connect()
  │    ├─ ① POST server/discover             → mode='modern'
  │    ├─ ② 失败 → POST 现代格式 tools/list  → mode='modern'
  │    └─ ③ 再失败 → POST initialize
  │              + notifications/initialized → mode='legacy'
  │
  ├─ 循环 tools/list（处理 nextCursor 分页）
  │    └─ rpc()
  │         ├─ post() → fetch(POST, headers, body, signal)
  │         ├─ readMessage()
  │         │    ├─ application/json → JSON.parse
  │         │    └─ text/event-stream → 逐事件读，匹配 id
  │         └─ 返回 result
  │
  └─ normalizeTools() → McpToolSnapshot[]
```

此时的数据仍是 MCP 原始描述，例如 `get_weather`，没有前缀。

#### 2.3 `createMcpTools()`：翻译成内部工具

[server/service/mcp/tool-adapter.ts](../../server/service/mcp/tool-adapter.ts)

每个工具被包装成：

```ts
{
  name: 'weather__get_weather',                  // slug + '__' + 原始名
  description: '[天气查询] 查询指定城市的当前天气',
  parameters: sanitizeInputSchema(inputSchema),  // Provider 可接受的子集
  permission: 'readonly',                        // annotations.readOnlyHint
  cacheable: true,                               // 只有明确只读才缓存
  toDefinition(),
  execute(args, signal) {
    const result = await client.callTool('get_weather', args, signal) // 还原原始名
    const text = flattenContent(result.content)
    if (result.isError) throw new McpToolError(text)
    return text
  }
}
```

#### 2.4 组装请求级注册表

[server/service/agent/tools/index.ts](../../server/service/agent/tools/index.ts)

```ts
const registry = createToolRegistry(mcpTools)
```

内部是 `Map<string, ExecutableTool>`：

```
calculator / web_search / web_fetch / search_knowledge_base
weather__get_weather / weather__echo / weather__always_fail
```

**这是本次重构的核心**：注册表从模块级单例变成请求级实例，避免 Workers 并发请求之间互相污染。

#### 2.5 生成工具定义与 system prompt

```ts
const toolDefinitions = registry.getDefinitions()
const effectiveSystemPrompt = buildSystemPrompt({ userPrompt, toolNames })
```

`ToolDefinition` 只保留 `{ name, description, parameters }`；`permission`、`cacheable`、`execute` 不传给模型。

#### 2.6 启动 Runner

```ts
runAgentLoop(provider, messages, chatOptions, registry)
```

路由把 `registry` 作为参数传入；Runner 不再 import 全局注册表。

### 第 3 步：ReAct 循环

[server/service/agent/runner.ts](../../server/service/agent/runner.ts)

```
for round = 1..maxIterations
  ├─ provider.chat(memory.getAll(), {
  │      ...options,
  │      tools: registry.getDefinitions().filter(未临时禁用)
  │  })
  │
  ├─ 消费 ReadableStream<LLMStreamChunk>
  │    ├─ text       → 中间轮丢弃 / 最终轮收集
  │    └─ tool_calls → 完整 ToolCall[]
  │
  ├─ 无 tool_calls → 输出最终回答
  │
  └─ 有 tool_calls
       ├─ yield tool_start
       ├─ registry.get('weather__get_weather')
       ├─ tool.execute(args, runSignal, toolContext)
       │    └─ adapter → client.callTool('get_weather', args)
       │         └─ POST tools/call → 外部 MCP Server
       ├─ yield tool_end { success, result }
       └─ memory 追加 role:'tool' 消息 → 下一轮
```

第二轮模型看到工具结果后不再调用工具，直接输出最终回答。

### 第 4 步：路由把事件转成 SSE + 落库

| Agent 事件 | 路由动作 | 前端收到 |
|---|---|---|
| `round_start` | SSE | 更新轮次 |
| `tool_start` | 累积 `pendingToolCalls` + SSE | 工具卡片（running） |
| `tool_end` | 落 `assistant(tool_calls)` + `tool` 消息 + SSE | 卡片完成 / 失败 |
| `text` | 创建最终消息 + 增量落库 + SSE | 流式文字 |
| `error` | 落错误消息 + SSE | 错误提示 |
| `done` | SSE | 结束 |

工具调用在 DB 中对应两条消息：

```
assistant: content='', toolCalls=[{ id, name:'weather__get_weather', arguments }]
tool:      content='上海：24°C，多云', toolCallId
```

### 第 5 步：前端渲染

```
useChat() 消费 SSE
  ├─ tool_start → chatStore.addAgentToolCall()
  ├─ tool_end   → chatStore.updateAgentToolCall()
  └─ text       → 追加内容
        ↓
AgentToolInline.vue
  ├─ TOOL_META 未收录 MCP 工具 → 回退原始名 + 扳手图标
  └─ 展开显示输入 / 输出（<pre> 纯文本）
```

---

## 四、数据形状的变化

| 边界 | 进入时 | 离开时 | 转换者 |
|---|---|---|---|
| 配置 | JSON 字符串 / 数组 | `McpServerConfig` | `normalizeServer` |
| MCP 响应 | JSON-RPC 消息 | `McpToolSnapshot[]` | `normalizeTools` |
| 工具描述 | Snapshot | `ExecutableTool` | `createMcpTools` |
| 工具集合 | `ExecutableTool[]` | `ToolRegistry` | `createToolRegistry` |
| 给模型 | `ToolRegistry` | `ToolDefinition[]` | `registry.getDefinitions()` |
| 给 Provider | `ToolDefinition[]` | OpenAI tools | `provider.chat` 内部 |
| 模型输出 | tool_calls 分片 | `ToolCall[]` | Provider 聚拢 |
| 工具执行 | `args` | `string` | adapter `execute` |
| 回填 | Agent 事件 | DB 消息 + SSE | 路由 switch |
| 前端 | SSE | UI 状态 | store + 组件 |

---

## 五、三条贯穿全链路的线

### 1. 取消信号

```
浏览器断开
  → llmAbortController.signal
      ├─ loadMcpTools(signal) → listTools 可取消
      └─ chatOptions.signal
           → runner runSignal（再合并 120s 超时）
           → tool.execute(args, runSignal)
           → client.callTool(..., signal)
           → fetch(..., { signal })
```

### 2. 工具名映射

```
MCP Server:  get_weather
     ↓ createMcpTools
模型看到:    weather__get_weather
     ↓ 模型 tool_call
registry.get('weather__get_weather')
     ↓ adapter 闭包
MCP Server:  get_weather
```

### 3. 两个 `disabledTools`

| 位置 | 含义 | 生效时机 |
|---|---|---|
| `McpServerConfig.disabledTools` | 管理页对某个 MCP 工具的持久开关 | `loadMcpTools` 时过滤 |
| `ToolContext.disabledTools` | 本次对话的临时禁用（如关闭知识库引用） | Runner 每轮请求前过滤 |

---

## 六、`list` 与 `call` 的时机

| 方法 | 作用 | 发生时机 |
|---|---|---|
| `tools/list` | 发现有哪些工具 | 装配 / 刷新配置时（快照存在时不发生） |
| `tools/call` | 执行指定工具 | 模型决定调用之后 |

模型本身永远不发起 `list`，只看到转换后的工具定义。

**当前开发阶段的特殊行为**：配置里 `tools` 为空，所以每次对话会现场 `listTools()`；M3 后工具快照落库，对话路径不再请求 `tools/list`。

---

## 七、当前边界

| 未完成 | 影响 |
|---|---|
| DB 持久化 | 配置只能写在 `.env`，生产环境工具为空 |
| 管理页 / CRUD API | 无法在界面添加 Server、测试连接、刷新工具 |
| 工具级开关界面 | 配置支持 `disabledTools`，但无 UI |
| 结构化工具结果 | 前端只显示文本，`structuredContent` 暂未使用 |
| resources / prompts | 明确不在本期范围 |
| 写操作审批 | `permission` 仅作标记 |

---

## 八、关键洞察

- **MCP 对 Agent 运行时是透明的**：Runner 只认 `registry`，不知道工具来自本地还是远端。
- **`ExecutableTool` 是缝**：MCP 工具与内置工具在这里汇合，模型侧完全无感。
- **`tools/list` 属于装配，`tools/call` 属于执行**：两者时机不同，不应混为一谈。
- **请求级注册表是前提**：动态工具不能塞进模块级单例，否则 Workers 并发请求会串数据。
- **错误分两类**：协议失败 `McpError` 中断；工具业务失败 `McpToolError` 回填给模型。
- **工具名必须加命名空间**：模型看到的是扁平列表，多 Server 同名工具必须可区分。

---

## 相关文档

- [Phase 4A MCP 接入技术设计](../../.claude/plan/phase4-mcp-design.md) — 主流程、模块边界、数据模型、关键决策
- [MCP 概念澄清](2026-10-18-mcp-concept-clarification.md) — 工具调用 / MCP / ExecutableTool 三层边界
- [Agent 工具系统实现详解](2026-07-29-agent-tool-system-implementation.md) — `ExecutableTool` 与 `ToolRegistry` 的由来
- [Agent ReAct 完整流程](2026-08-05-agent-react-full-flow.md) — 工具调用循环的既有实现
- [实施路线图](../../.claude/plan/roadmap.md) — Phase 4A 进度
