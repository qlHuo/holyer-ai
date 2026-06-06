# 2026-06-05 — 对话 CRUD + chat 端点代码审查：Service 层缺失与 SSE 工具绕过

> 架构文档写的模式是"API 路由 → Service 层 → 数据库"，但对话相关代码全部挤在 API 路由里。这不是"当前阶段可以接受"——chat 端点已经 254 行，到 Phase 2 Agent 引入后必然失控。

---

## 讨论背景

Phase 1.6 对话持久化代码（4 个 CRUD 端点 + chat 端点改造）于 2026-06-03 编写完毕。2026-06-05 进行代码审查，发现两个结构性问题和一个数据正确性 bug。

审查范围：`server/api/chat/index.post.ts` (254 行)、`server/api/conversations/index.get.ts` (53 行)、`server/api/conversations/index.post.ts` (39 行)、`server/api/conversations/[id].get.ts` (62 行)、`server/api/conversations/[id].delete.ts` (37 行)、`server/utils/sse.ts`。

---

## 问题 1：Service 层缺失 — 业务逻辑与数据库操作混在一起

### 现象

CRUD 端点直接 import `db` 和 schema 在 handler 里做 SQL 操作。chat 端点更严重 —— 254 行中混杂了会话管理、消息持久化、LLM 调用、SSE 传输四种职责。

### 严重度评估

| 端点 | 行数 | DB 操作 | 当前可维护性 | Phase 2 风险 |
|------|:---:|:---:|:---:|:---:|
| index.get.ts | 53 | 3 处 | 🟡 还行 | 低 — Agent 不调此端点 |
| index.post.ts | 39 | 1 处 | 🟢 简单 | 低 |
| [id].get.ts | 62 | 2 处 | 🟡 还行 | 低 |
| [id].delete.ts | 37 | 2 处 | 🟢 简单 | 低 |
| **chat/index.post.ts** | **254** | **6 处** | 🔴 **失控边缘** | 🔴 **极高** |

chat 端点承载了 5 种职责：

```
参数校验 → 查/建对话 → 存用户消息 → 调 LLM → 逐 token 推 SSE → 存 assistant 消息 → 发 done 事件
```

Phase 2 Agent 的 ReAct 循环意味着：LLM 调用 → tool_call → 执行工具 → **存 tool 消息** → 再调 LLM → ... 反复多次。如果这些逻辑全塞在一个 handler 里，chat 端点将膨胀到 400~500 行。

### 根因

架构文档明确写的是三层模式（API → Service → DB），但 Phase 1.6 的实现没有建 Service 层。原因：CRUD 端点逻辑简单（~30 行），加一层感觉像"透传"。但 chat 端点打破了平衡 —— 6 处 DB 操作 + 流式逻辑，明显越过了 handler 的职责边界。

---

## 问题 2：SSE 工具被绕过 — chat 端点内联了 70% 的重复代码

### 现象

原本的 `createSSEResponse(sourceStream, event)` 被注释掉（L162-170），改为了 chat 端点内联构建 `ReadableStream`（L172-252）。两段代码的重复度：

| 功能 | `createSSEResponse` | chat 内联 | 重复？ |
|------|:---:|:---:|:---:|
| `isClosed` 标志 + close 监听 | L16-23 | L124-129 | ✅ |
| `cancel()` 回调 | L66-68 | L240-242 | ✅ |
| 心跳 `setInterval` 30s | L30-36 | L180-186 | ✅ |
| `TextEncoder` + SSE 格式 | L27, L46-48 | L131, L136-158 | ✅ |
| Response 构造 + 4 个响应头 | L72-79 | L245-252 | ✅ |
| 错误处理 | L54-59 | L231-233 | ✅ |

### 当初不用的理由（重新审视）

设计文档 [2026-06-03-conversation-persistence-design.md](./2026-06-03-conversation-persistence-design.md) 的理由：

> chat 端点有自己的独特生命周期：流开始前发 meta 事件 → 流结束后写库 → 再发 done。如果在 `createSSEResponse` 里加 `onStart`/`onDone` 回调，会把"保存 assistant 消息"这种业务逻辑侵入通用工具。

这个判断**方向正确**（通用工具不该带业务逻辑），但**结论有误**（不该因此放弃复用）。

### 正确的解法：泛化 `createSSEResponse` 的输入契约

当前契约太窄 —— 只接受 `ReadableStream<string>`（纯文本 token 流），统一包成 `{"type":"text","content":"..."}`。但 chat 端点需要发多种事件（meta / text / done / error），无法用这个契约表达。

**修正方案**：把 `createSSEResponse` 的输入改为 `ReadableStream<SSEChunk>`（结构化事件流），让上游端点构建自己的事件序列，SSE 工具只负责格式转换和传输：

```
端点职责（业务事件序列）              SSE 工具职责（纯传输）
─────────────────────────            ─────────────────────
什么时候发 meta                         SSEChunk → wire format
什么时候写库                           心跳 + close 检测
什么时候发 done / error                Response 构造 + 响应头
                             ← 中间是 ReadableStream<SSEChunk> →
```

**效果**：chat 端点不再需要内联 SSE 格式转换代码（节省 ~80 行），Agent 端点（Phase 2）**零改动**复用同一个 SSE 工具。

---

## 问题 3：contentBuffer 累积发送 bug（🔴 数据正确性）

[chat/index.post.ts:199-204](D:\workspace\holyer-ai\server\api\chat\index.post.ts#L199-L204)：

```ts
let contentBuffer = ''
while (true) {
  const { done, value } = await reader.read()
  if (done || isClosed) break
  contentBuffer += value          // ← 累积
  enqueueText(controller, contentBuffer)  // ❌ 发送累积值！
}
```

Provider 输出的是 Delta 模式（每次只给新 token）。假设 LLM 返回 `"你" → "好" → "吗"`：

| 循环 | value | contentBuffer | 发给客户端 | 客户端实际显示 |
|------|-------|:--------------|-----------|--------------|
| 1 | "你" | "你" | "你" | 你 |
| 2 | "好" | "你好" | "你好" | 你**你好** ❌ |
| 3 | "吗" | "你好吗" | "你好吗" | 你你好**你好吗** ❌ |

**修复**：`enqueueText(controller, value)` — 只发增量，contentBuffer 仅用于流结束后写库。

---

## 问题 4：次要问题

### 4.1 N+1 查询（🟡 性能）

[index.get.ts:25-39](D:\workspace\holyer-ai\server\api\conversations\index.get.ts#L25-L39) — 先查对话列表，然后每条对话循环内发 2 次独立 SQL（count + last message）。20 条对话 = 1 + 40 = 41 次 DB 往返。

提取到 Service 层后，用一条带子查询/JOIN 的 SQL 替换。

### 4.2 重复更新 `updatedAt`（🟡 浪费）

chat 端点 L115-118 和 L216-219 各执行了一次 `UPDATE conversations SET updated_at = ...`。第一次（存完用户消息后）完全多余。保留流结束后的那次即可。

### 4.3 `toolCallId ?? undefined` 在写入路径上无意义（🟡）

[chat/index.post.ts:110](D:\workspace\holyer-ai\server\api\chat\index.post.ts#L110)：`msg.toolCallId ?? undefined` — 左侧已经是 `string | undefined`，和 `undefined` 做 `??` 是恒等变换。Drizzle 中 `undefined` 语义是"不设值（跳过该列）"而非"设为 NULL"，正确写法是 `msg.toolCallId ?? null`。

### 4.4 `as` 类型断言泛滥（🟢 风格）

[index.post.ts:31-37](D:\workspace\holyer-ai\server\api\conversations\index.post.ts#L31-L37) 和 [id].get.ts](D:\workspace\holyer-ai\server\api\conversations\[id].get.ts#L47-L49) 多处使用 `as string`、`as Message['role']`。提取到 Service 层后，类型转换集中在 Service 内部，一次写对，所有端点复用。

---

## 关键洞察

- **Service 层的价值不在"当前代码量"，在"防止未来失控"**：4 个 CRUD 端点现在确实简单，但 chat 端点已经越界。Phase 2 Agent 引入 tool 消息循环后，没有 Service 层意味着 handler 直接承担循环中的多次 DB 操作——届时 handler 将膨胀到 400+ 行，再拆的成本远高于现在
- **SSE 工具的复用不是"要不要"，是"怎么要"**：限制复用的不是工具本身的设计缺陷，而是其契约（`ReadableStream<string>`）太窄。泛化为 `ReadableStream<SSEChunk>` 后，所有端点都能复用
- **Delta 模式的 consumer 必须区分"用于显示"和"用于存储"**：`contentBuffer`（存储）需要累积，`enqueueText`（显示）需要增量。两者混用 = 数据正确性 bug
- **代码审查的时间点是对的**：Phase 1.6 刚刚写完，Phase 2 还没开始。现在重构成本低（~2 小时），后续涉及 Agent 工具调用循环时再改，涉及面就大了

---

## 相关文档

- [2026-06-03 对话持久化设计](./2026-06-03-conversation-persistence-design.md) — 本次审查的前置设计
- [2026-06-03 SSE 工具实现](./2026-06-03-sse-implementation.md) — createSSEResponse 原始设计
- [2026-06-01 Provider 实现记录](./2026-06-01-provider-implementation.md) — 参考：LLM 层的 Service 模式
- [架构设计](../../.claude/plan/architecture.md) — 3.1 明确了"API 路由 → Service 层"三层模式
- [实施路线图](../../.claude/plan/roadmap.md) — Phase 1 任务清单
