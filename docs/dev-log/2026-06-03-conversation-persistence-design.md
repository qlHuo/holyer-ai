# 2026-06-03 — 对话持久化设计：不止 CRUD

> Phase 1.6 的核心不是"增删查"三个端点，而是让 `/api/chat` 从无状态管道变成有记忆的对话引擎。三层工作互相关联，每一层的设计都在为 Phase 2 Agent 铺路。

---

## 讨论背景

Phase 1.4（/api/chat）和 1.3（SSE 工具）完成后，进入 1.6 对话持久化。roadmap 中该任务的描述只有"conversations + messages 表 + CRUD API"一行，但实际展开后发现它跨越了三层：数据层（CRUD）、业务层（chat 改造）、传输层（SSE 增强）。

讨论围绕四个问题展开：Schema 是否完整？CRUD 有哪些注意事项？chat 改造如何处理流中写库的约束？还有哪些边界问题？

---

## 核心结论

### 1. Phase 1.6 的三层工作全景

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: CRUD API                                      │
│  conversations 表的基本增删查                            │
├─────────────────────────────────────────────────────────┤
│  Layer 2: /api/chat 改造（记忆注入）                     │
│  加载历史 → 拼装上下文 → 调 LLM → 保存新消息              │
├─────────────────────────────────────────────────────────┤
│  Layer 3: SSE 响应增强                                  │
│  流中带回 conversationId + messageId，前端知道"谁是谁"    │
└─────────────────────────────────────────────────────────┘
```

三层互相依赖：CRUD 是数据基础，chat 改造是核心逻辑，SSE 增强是前端能消费的前提。

### 2. Schema 扩展：只加一列

当前 `messages` 表有 `tool_calls`（JSONB，assistant 发出的工具调用），但缺少 `tool_call_id`（tool 结果关联到哪个调用）。

```ts
// shared/types/provider.ts 的 Message 接口
interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  toolCalls?: ToolCall[]   // ← 表里有 (jsonb)
  toolCallId?: string      // ← 表里没有！
}
```

**决策**：现在加 `tool_call_id`（nullable varchar），Phase 2 Agent 引入 tool 消息时必须用到，现在不加到时候要多一次迁移。

**不加的字段**：`token_count`（Phase 1 不做计费）、`system_prompt`（应由 Skills 动态注入，不绑定到对话）、`metadata`（通用扩展字段，真需要时再加）。

### 3. `/api/chat` 改造的核心约束：流中不能写库

这是整个设计最重要的技术约束。改造后 chat 端点的执行顺序：

```
① 有 conversationId → 加载历史，拼装上下文
   无 conversationId → 新建对话，拿到 ID

② 保存用户消息到 messages 表 ← 调 LLM 之前

③ provider.chat(allMessages, options) → ReadableStream

④ 逐 token 推 SSE + 内存拼接 contentBuffer ← 这里不能写库

⑤ 流结束后，一次性 insert assistant 消息

⑥ 发 done 事件（带 conversationId + messageId）
```

**为什么先保存用户消息**：即使 LLM 调用失败，用户消息也不丢。"宁可多存不能少存"。

**为什么不能流中写库**：每个 token 一次 Neon HTTP 请求 = 一个回复 500 次 DB 操作。不是技术不可行，而是架构上不应该——流的内层是高频事件，数据库是低频操作，边界必须清晰。

### 4. CRUD 端点设计要点

| 端点 | 关键决策 |
|------|---------|
| `GET /api/conversations` | 按 `updated_at DESC` 排序；返回消息数量 + 最后一条消息前 50 字预览；不做分页（Phase 1） |
| `POST /api/conversations` | title 默认"新对话"；创建后立即返回完整对象；主流程是通过 chat 自动创建，此端点保留给"空对话占位"场景 |
| `GET /api/conversations/[id]` | 消息按 `created_at ASC`；不存在返回 404 |
| `DELETE /api/conversations/[id]` | cascade 由 DB 外键处理；不存在返回 404 |

**关于对话创建的时机**：以"前端直接调 chat（不传 conversationId），后端自动创建对话"为主流程。用户不需要先创建对话再发消息——太繁琐。

### 5. 扩展性预留

**SSE 事件类型扩展**：

```
// Phase 1 现在
data: {"type":"text","content":"你好"}
data: {"type":"done"}

// Phase 1.6 改造后
data: {"type":"meta","conversationId":"uuid"}           ← 流开始就告知 ID
data: {"type":"text","content":"你好"}
data: {"type":"done","conversationId":"uuid","messageId":"uuid"}

// Phase 2 Agent 自然扩展
data: {"type":"tool_call","name":"search","arguments":"..."}
data: {"type":"tool_result","content":"..."}
```

`createSSEResponse` 本身不需要改——它只管包装 `ReadableStream<string>` 为 SSE 格式。事件类型的扩展在 chat 端的 payload 构造层完成。

**Agent 多轮工具调用兼容**：Phase 1 的流结束后只存一条 assistant 消息，但代码不写死"只存一条"。把保存逻辑抽成独立函数，Phase 2 自然扩展为循环中多次调用。

**system prompt 不持久化**：`options.systemPrompt` 每次请求透传，Phase 2 Skills 动态注入，这个设计不变。

### 6. 边界问题汇总

| 问题 | 处理方式 |
|------|---------|
| **并发竞态** | Phase 1 前端层面解决（streaming 期间禁用输入框），不做后端锁 |
| **updated_at 不自动更新** | Drizzle `defaultNow()` 只处理 INSERT，每次新增消息后手动 update |
| **参数校验** | `conversationId` 若传入必须存在；`message` 不能为空；用 if 判断，不引入 zod |
| **错误消息不入库** | LLM 调用失败时仅推 SSE error 事件，不写 assistant 消息到库 |
| **content 空值** | 保证传入空字符串 `''` 而非 `null`，满足 `notNull()` 约束 |
| **DB 连接生命周期** | 模块顶层创建，Nitro 在 Workers 中每次请求独立实例化，无状态安全 |

---

## 7. 实现级决策：SSE 工具不改，chat 端点内联

### 原始设计 vs 实现决策

原设计认为 `server/utils/sse.ts` 需要增强——done 事件增加 `conversationId`/`messageId`。但实际编写代码时发现这个思路有问题：

**`createSSEResponse` 是一个通用工具**，职责是"把 `ReadableStream<string>` 包装成 SSE Response"。它的生命周期是：
1. 消费 source stream
2. 每个 token 转成 `data: {"type":"text","content":"..."}\n\n`
3. 流结束后发送 `data: {"type":"done"}\n\n`

而 chat 端点有自己的独特生命周期：
1. 流开始前 → 发 `meta` 事件（conversationId）
2. 逐 token 推送
3. **流结束后 → 写库（保存 assistant 消息）→ 再发 done**

如果在 `createSSEResponse` 里加 `onStart`/`onDone` 回调，确实能支持这种场景，但会把"保存 assistant 消息"这种业务逻辑侵入通用工具。

**决策**：chat 端点内联 SSE 格式转换逻辑，不调用 `createSSEResponse`。`createSSEResponse` 保持不变，留给 Phase 2 的 `/api/agent/run` 等不需要"流后写库"的端点用。

### 内联方案的代码结构

```ts
// chat 端点自己构建 ReadableStream，内联处理 SSE 格式
const stream = new ReadableStream({
  async start(controller) {
    // ① 立即发 meta 事件 —— 前端尽早拿到 conversationId
    enqueueMeta(controller, { conversationId: convId })

    // ② 心跳
    const heartbeat = setInterval(() => { ... }, 30000)

    try {
      // ③ 调 LLM，逐 token 推 text 事件 + 拼接 contentBuffer
      const llmStream = await llmProvider.chat(allMessages, options)
      const reader = llmStream.getReader()
      let contentBuffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done || isClosed) break
        contentBuffer += value
        enqueueText(controller, value)
      }

      // ④ 流结束后 → 一次性 INSERT assistant 消息
      const [saved] = await db.insert(messages).values({
        conversationId: convId,
        role: 'assistant',
        content: contentBuffer
      }).returning()

      // ⑤ 发 done 事件（带 messageId）
      enqueueDone(controller, { conversationId: convId, messageId: saved.id })
    } catch (error) {
      // ⑥ LLM 调用失败 → 只发 error 事件，不写库
      enqueueError(controller, error.message)
    } finally {
      clearInterval(heartbeat)
      controller.close()
    }
  }
})
```

### 四个辅助函数

```ts
function enqueueMeta(c, payload)   → data: {"type":"meta","conversationId":"..."}\n\n
function enqueueText(c, content)   → data: {"type":"text","content":"..."}\n\n
function enqueueDone(c, payload)   → data: {"type":"done","conversationId":"...","messageId":"..."}\n\n
function enqueueError(c, content)  → data: {"type":"error","content":"..."}\n\n
```

本质就是把 `createSSEResponse` 的格式转换逻辑拆成了四个独立函数，在 chat 端点自己掌控的 ReadableStream 里按需调用。

### 为什么不复用 createSSEResponse

| 方案 | 优点 | 缺点 |
|------|------|------|
| A: 改造 SSE 工具加回调 | chat 端点代码更短 | 通用工具承担业务逻辑，Phase 2 Agent 端点不想写库时也要传空回调 |
| B: chat 内联（**采纳**） | 职责清晰，SSE 工具保持纯净 | chat 端点多了 ~40 行格式转换代码 |

40 行格式转换代码换一个职责清晰的通用工具——值。

### 具体实现细节

**`toolCallId` 为什么是 `varchar(100)` 而不是 `uuid`**：`tool_call_id` 的值来自 LLM 返回的 `tool_calls[].id`（如 `"call_abc123"`），不是你自己生成的。100 长度足够覆盖所有 Provider 的 ID 格式。

**`toolCallId ?? null` 转换**：Message 接口定义的是 `string | undefined`，但 Drizzle nullable varchar 返回 `string | null`。写库时用 `?? null` 把 `undefined` 转为 `null`（PostgreSQL 标准空值），读库时用 `?? undefined` 转回来。

**`message` 是数组，循环插入**：前端可能一次发多条（如 `[{role:'user', content:'...'}, {role:'tool', content:'...', toolCallId:'...'}]`），每条都要存。

---

## 改动清单（实现后修正）

| 优先级 | 文件 | 动作 |
|:---:|------|------|
| 🔴 | `server/db/schema.ts` | messages 表加 `tool_call_id` 列 |
| 🔴 | `shared/types/conversation.ts` | **新建** — 前后端共享类型 |
| 🔴 | `server/api/conversations/index.get.ts` | **编写** — 对话列表 |
| 🔴 | `server/api/conversations/index.post.ts` | **编写** — 新建对话 |
| 🔴 | `server/api/conversations/[id].get.ts` | **新建** — 对话详情 + 消息历史 |
| 🔴 | `server/api/conversations/[id].delete.ts` | **新建** — 删除对话 |
| 🔴 | `server/api/chat/index.post.ts` | **重写** — 内联 SSE + 注入历史 + 保存消息 + 返回 ID |
| ⬜ | `server/utils/sse.ts` | **不改** — 保持通用，留给 Phase 2 Agent 端点复用 |

> **相比原始设计的变更**：`server/utils/sse.ts` 从 🟡（需增强）变为不修改。chat 端点改为内联 SSE 格式转换，在自己的 ReadableStream 中控制 meta→text→done 事件序列和流后写库时机。

---

## 关键洞察

- **对话持久化的核心不在 CRUD，在 chat 改造**：四个 CRUD 端点半小时写完，真正花时间的是 chat 端点的上下文注入和流后保存逻辑
- **"流中不能写库"是架构边界不是性能优化**：即使 Neon 延迟为零，也不应该在每秒 50 次的 token 流中嵌入数据库操作——这是关注点分离，不是性能调优
- **Schema 的 `tool_call_id` 现在加是对的**：它现在只是 nullable varchar，但 Phase 2 没有它就会卡住。提前一列的成本远低于事后迁移
- **SSE 的 `meta` 事件让前端尽早拿到 conversationId**：不需要等流结束才知道对话 ID，前端可以立即更新 URL（`/chat/abc-123`）和侧边栏列表
- **通用工具不该为业务需求变形**：原设计想给 `createSSEResponse` 加回调来支持流后写库，但 chat 端点内联 SSE 逻辑后，通用工具保持纯净，Phase 2 Agent 端点也能直接复用。40 行格式转换代码换一个职责清晰的工具——值

---

## 相关文档

- [2026-06-03 SSE 工具实现](./2026-06-03-sse-implementation.md) — chat 改造的前置依赖
- [2026-06-01 Provider 实现记录](./2026-06-01-provider-implementation.md) — Provider 层接口
- [2026-05-31 流式架构深层讨论](./2026-05-31-streaming-architecture.md) — 四段流式模型
- [2026-05-31 项目初始化指南](./2026-05-31-scaffold-guide.md) — Phase 1.6 原始规划
- [架构设计](../../.claude/plan/architecture.md) — 3.1 LLM Provider 抽象层
- [实施路线图](../../.claude/plan/roadmap.md) — Phase 1 任务清单

---

## 2026-06-05 代码审查修正

> 审查报告详见 [2026-06-05-code-review-conversation.md](./2026-06-05-code-review-conversation.md)，此处记录设计层面需要修正的决策。

### 修正 1：SSE 工具不应被绕过

**原设计**："chat 端点内联 SSE 逻辑，不调用 `createSSEResponse`"

**审查发现**：chat 端点内联的 SSE 代码与 `createSSEResponse` 重复度超过 70%。限制复用的不是工具设计缺陷，而是其输入契约（`ReadableStream<string>`）太窄。

**修正方案**：将 `createSSEResponse` 的输入泛化为 `ReadableStream<SSEChunk>`：

```ts
interface SSEChunk {
  type: 'text' | 'meta' | 'tool_call' | 'tool_result' | 'done' | 'error'
  [key: string]: unknown
}

function createSSEResponse(sourceStream: ReadableStream<SSEChunk>, event: H3Event): Response
```

这样 chat 端点只负责"构建事件序列"（meta → text... → done），SSE 工具负责"格式转换 + 心跳 + 响应头"。Phase 2 Agent 端点直接复用，零改动。

### 修正 2：contentBuffer 发送 bug

**原设计的代码结构**：

```ts
contentBuffer += value
enqueueText(controller, contentBuffer)  // ❌ 发送累积值
```

Provider 输出是 Delta 模式（每次新 token），但 `enqueueText` 发送的是累积后的全量文本。客户端会收到重复内容。

**修正**：`enqueueText(controller, value)` — 只发增量。`contentBuffer` 仅用于流结束后一次性写库。

### 修正 3：缺少 Service 层

**原设计**："四个辅助函数 + chat 端点自己掌控 ReadableStream"

**审查发现**：架构文档明确是三层模式（API → Service → DB），但对话代码全部挤在 API 路由里。CRUD 端点可以接受，但 chat 端点已有 6 处 DB 操作，到 Phase 2 Agent 引入 tool 消息循环后会失控。

**修正方案**：新增 `server/service/conversation/` 目录，提取 DB 操作到 Service 层。详见 [2026-06-05-code-review-conversation.md](./2026-06-05-code-review-conversation.md)。
