# 2026-06-25 — 流式串话：根因深度分析与两道防线修复

> 表象：流式输出中切换对话，新对话消息被旧对话内容覆盖。深入分析后揭示两个架构级缺陷：`messages` 全局单数组与对话无绑定、`useChat()` 三次独立实例化导致状态分片。修复采用两道防线——Store 层 `streamingConvId` 校验 + Composable 层 abort 清理。

---

## 一、问题表象

**复现步骤**：

1. 在对话 A 中发送消息，LLM 开始流式输出
2. 不等流结束，切换到对话 B
3. 对话 B 的最后一条消息被替换为 A 的流式内容

**用户观察**："切到 B 对话后，B 的消息变成了 A 对话正在生成的内容"。

---

## 二、数据流全景

理解这个 bug 需要先看清一条用户消息的完整旅程：

```
用户输入 "你好"
  │
  ▼
ChatInput.handleSend()
  → useChat().sendMessage("你好")              // composable 闭包
    → chatStore.addMessage(userMsg)             // Store：用户消息入 messages[]
    → chatStore.startStreaming()                // Store：插入空 assistant 占位
    → fetch('/api/chat', { signal })            // 网络层：带 AbortSignal 的 POST
      │
      ▼  ─────────── 网络边界 ───────────
      │
      ▼
server/api/chat/index.post.ts
  → getOrCreateConversation(id)                 // 获取/创建对话
  → addMessages(convId, userMsg)                // 用户消息持久化到 DB
  → insertMessage(convId, assistant空占位)       // ★ 1.28：流前插空占位
  → llmProvider.chat(history)                   // 调用 LLM → ReadableStream
    → while (reader.read())                     // 逐 token 读取
      → controller.enqueue(TEXT, content)       // 发给 SSE 传输层
      → updateMessage(id, contentBuffer)        // ★ 1.28：每 200 字符增量写 DB
    → controller.enqueue(DONE)                  // 流结束事件
  → createSSEResponse(eventStream)              // SSE 格式包装 + 30s 心跳
      │
      ▼  ─────────── 网络边界 ───────────
      │
      ▼
useChat().consumeSSEStream(response)            // composable 闭包：逐帧解析
  → reader.read() → 分帧 → JSON.parse
    → handleSSEEvent({ type: 'text', content: '你' })
      → chatStore.appendStreamContent('你')      // ★ 问题发生点
        → messages[last].content += '你'          // 盲写最后一条消息
```

---

## 三、根因一（核心缺陷）：`messages` 全局单数组

### 3.1 状态建模错误

[chat.store.ts:23](app/stores/chat.store.ts#L23)：

```ts
const messages = ref<Message[]>([])
```

`messages` 是全局单例，不携带任何"我属于哪个对话"的信息。当 `currentConvId` 从 A 切换到 B 时：

```ts
// selectConversation (第 60 行)
messages.value = []              // 清空 A 的消息
messages.value = data.messages   // 加载 B 的历史消息
```

但**旧流 A 的 SSE 消费回路仍然持有对同一个 `messages` 的引用**——因为 Pinia store 是单例，`messages` 始终是同一个 `ref` 对象。

### 3.2 `appendStreamContent` 的盲写

[chat.store.ts:126-135](app/stores/chat.store.ts#L126-L135)：

```ts
function appendStreamContent(chunk: string) {
  streamContent.value += chunk
  const lastMsg = messages.value[messages.value.length - 1]
  if (lastMsg && lastMsg.role === 'assistant') {
    lastMsg.content = streamContent.value  // ← 不关心这个 messages 属于哪个对话
  }
}
```

这个函数做了两个错误假设：
- **假设 messages 一定属于当前对话**：实际上可能已被替换为 B 的历史
- **假设最后一条消息就是正在流的那条**：实际上 B 的最后一条可能是任意旧消息

### 3.3 完整竞态时序

```
T=0.0s   用户在对话 A，输入"今天天气怎么样"
           → sendMessage → startStreaming
           → messages = [{role:'user', content:'今天天气怎么样'}, {role:'assistant', content:''}]
           → fetch /api/chat (A) 发起

T=0.5s   服务端返回第一个 TEXT chunk: "北京今天"
           → appendStreamContent("北京今天")
           → messages[1].content = "北京今天"  ✅ 正确

T=1.0s   用户点击侧边栏切换到对话 B
           → selectConversation('B')
           → messages = []                                      ← 清空
           → messages = [B-msg1, B-msg2, ..., B-last-assistant]  ← 加载 B 的历史

T=1.2s   对话 A 的 SSE chunk 到达: "晴，气温25度"
           → appendStreamContent("晴，气温25度")   ← 盲写！
           → messages[last] = B-last-assistant
           → B-last-assistant.content = "晴，气温25度"  ← 💥 B 的消息被 A 的内容覆盖
```

这就是用户观察到的现象：B 的消息变成了 A 的流式内容。

### 3.4 为什么不是简单的 `messages[last]` 问题

即使加入"找最后一条内容为空的 assistant"逻辑，仍然不够：

- B 的 messages 可能根本没有 assistant 消息（全是 user 消息）
- B 的最后一条 assistant 消息可能恰好 content 为空（另一个流正在运行）
- `streamContent` 的累计值也是全局的——它累积 A 流的内容，但 `finishStreaming` 清空它时，清的是全局变量，影响所有对话

**根本问题是状态模型**：`messages`、`streamContent`、`isStreaming` 应该建模为"每个对话一个实例"，但当前是全局单例。

---

## 四、根因二（放大缺陷）：`useChat()` 三次独立实例化

### 4.1 调用分布

| 组件 | 文件 | 获取 |
|------|------|------|
| ChatInput | [ChatInput.vue:2](app/components/chat/ChatInput.vue#L2) | `{ isSending, sendMessage, abort }` |
| ChatMessageActions | [ChatMessageActions.vue:9](app/components/chat/ChatMessageActions.vue#L9) | `{ regenerate, isSending }` |
| ChatPanel | [ChatPanel.vue:3](app/components/chat/ChatPanel.vue#L3) | `{ error }` |

每次调用 `useChat()` 创建一个**独立闭包**，各自拥有私有的 `abortController`、`isSending`、`watch`：

```
ChatInput 实例:               ChatMessageActions 实例:        ChatPanel 实例:
  abortController = X          abortController = null          abortController = null
  isSending = ref(false)       isSending = ref(false)          isSending = ref(false)
  watch(currentConvId)         watch(currentConvId)            watch(currentConvId)
```

### 4.2 为什么"恰好没炸"

当前有三个保护性巧合：

**巧合 1 — watch 兜底**：三个实例的 `watch` 都监听了 `currentConvId`。切换对话时，ChatInput 实例持有 `abortController`，所以它的 watch 能成功 abort。另外两个实例的 `watch` 因 `abortController` 为 null 而什么都不做——无害但多余。

**巧合 2 — 只有一个组件发消息**：`sendMessage()` 只在 ChatInput 中调用，`regenerate()` 只在 ChatMessageActions 中调用。没有跨组件 abort 的需求。

**巧合 3 — `isSending` 分片掩盖了按钮失效**：ChatInput 的停止按钮绑定 ChatInput 实例的 `isSending`。当 `regenerate()`（ChatMessageActions 实例）运行时，ChatInput 的 `isSending` 仍为 `false`，停止按钮不显示。用户不会发现"停止按钮无法停止 regenerate 流"——按钮根本没出现。

### 4.3 何时会炸

以下任一改动都会暴露这个缺陷：

- 在 ChatPanel 中加"停止生成"按钮 → 调用 ChatPanel 的 `abort()`，但它的 `abortController` 永远是 null
- 在 ChatMessageActions 中加停止按钮 → 无法停止 ChatInput 发起的流
- 引入新组件需要发送消息 → 新实例的 `isSending` 和 `abortController` 与现有实例完全隔离

### 4.4 根治方向

将 `isSending`、`abortController` 提升到**模块级单例**（在 `useChat` 函数外部声明）：

```ts
// useChat.ts — 模块级单例
let abortController: AbortController | null = null
const isSending = ref(false)

export function useChat() {
  // 所有调用方现在共享同一个 abortController 和 isSending
}
```

这样 ChatInput 的停止按钮可以停止任何流，不论它由哪个组件发起。

---

## 五、修复体系：两道防线

### 5.1 防线一（Store 层）：`streamingConvId` 校验

[chat.store.ts:28](app/stores/chat.store.ts#L28) — 新增状态：

```ts
/** 正在流的对话 ID（null 表示尚未分配 ID 的新对话），appendStreamContent 据此校验防止串话 */
const streamingConvId = ref<string | null>(null)
```

四个关键时机：

| 时机 | 操作 | 代码位置 |
|------|------|---------|
| `startStreaming()` | `streamingConvId = currentConvId` | [第 119 行](app/stores/chat.store.ts#L119) |
| `appendStreamContent()` | `if (streamingConvId !== currentConvId) return` | [第 127 行](app/stores/chat.store.ts#L127) |
| `finishStreaming()` | `streamingConvId = null` | [第 142 行](app/stores/chat.store.ts#L142) |
| `setCurrentConvId()` | Path B 桥接：`null → 真实 ID` | [第 150-152 行](app/stores/chat.store.ts#L150-L152) |

**Path B 桥接说明**：新建对话时 `currentConvId` 初始为 `null`，META 事件才分配真实 ID。此时 `streamingConvId` 也是 `null`，与 `currentConvId`（`null`）相等，chunk 正常通过。当 META 事件到达并调用 `setCurrentConvId` 时，如果 `isStreaming && streamingConvId === null`，同步 `streamingConvId = 新 ID`，后续 chunk 继续正常通过。

**效果**：即使旧流的 SSE chunk 绕过了 abort 到达 `appendStreamContent`，它发现 `streamingConvId`（旧对话 ID）≠ `currentConvId`（新对话 ID），直接 return。**这道防线不依赖时序，只看归属**。

### 5.2 防线二（Composable 层）：`watch` + abort 清理

[useChat.ts:36-40](app/composables/useChat.ts#L36-L40)：

```ts
watch(() => chatStore.currentConvId, (newId, oldId) => {
  if (oldId && newId !== oldId) {
    abort()
  }
})
```

关键守卫：
- `oldId` 必须存在 — 防止 Path B（`null → 真实ID`）自中断
- `newId !== oldId` — 同一对话不触发

`abort()` 函数（[第 228-233 行](app/composables/useChat.ts#L228-L233)）：
```ts
function abort() {
  if (abortController) {
    abortController.abort()
    abortController = null
  }
}
```

### 5.3 两道防线如何协同

```
旧流 A 的 SSE chunk 到达
  │
  ▼
consumeSSEStream 帧循环
  ├─ fetch 已被 abort → reader 抛出 AbortError → handleStreamError → finishStreaming
  │   （大多数帧在此被拦截）
  │
  ▼  （极少数 buffer 残留帧绕过 abort）
handleSSEEvent → appendStreamContent
  ├─ streamingConvId('A') ≠ currentConvId('B')? → return  ← 防线一：拒收
  │
  ▼
messages[last].content += chunk                          ← 安全写入（仅当 convId 匹配）
```

- **防线二**（watch + abort）是**主动清理**：切断 SSE 连接，阻止新帧到达
- **防线一**（streamingConvId）是**被动兜底**：即使有漏网之鱼，也拒绝写入

---

## 六、后端视角

### 6.1 客户端断开时的服务端行为

[server/api/chat/index.post.ts:79-82](server/api/chat/index.post.ts#L79-L82)：

```ts
let isCancelled = false
event.node?.req?.on('close', () => {
  isCancelled = true
})
```

当客户端 abort → HTTP 连接断开 → Nitro 触发 `req.on('close')` → `isCancelled = true` → while 循环下次迭代检测到后退出。

**但有两个关键时序问题**：

**问题 1 — `req.on('close')` 是异步事件**：在它触发前，LLM 流可能还在产生 token，while 循环继续运行，`updateMessage` 继续写 DB。这些写入不会丢失——增量写入确保最后一次成功的 UPDATE 已持久化。最多丢失 199 字符。

**问题 2 — LLM 流未真正取消**：`llmProvider.chat()` 不接收 `AbortSignal`。当 while 循环退出时，底层的 LLM API 调用仍在运行，token 持续生成直到自然结束或 LLM 服务端超时。这是当前接受的 trade-off：个人应用偶尔浪费几十个 token 成本可忽略。

### 6.2 `createSSEResponse` 的双层 ReadableStream

[server/utils/sse.ts:32-94](server/utils/sse.ts#L32-L94)：

```
内层 eventStream (index.post.ts 构建)
  → controller.enqueue({ type: 'text', content: '你好' })
     │
     ▼
外层 stream (createSSEResponse 构建)           ← SSE 格式转换层
  → reader.read() 从内层取 SSEChunk
  → encoder.encode(`data: ${JSON.stringify(value)}\n\n`)
  → controller.enqueue(encoded)
     │
     ▼
  Response → HTTP → 客户端
```

当客户端断开时：
- 外层 `ReadableStream.cancel()` 触发 → `isClosed = true`
- 外层的 while 循环下次迭代 break → `controller.close()`
- 内层通过 `req.on('close')` + `isCancelled` 标记感知 → while 循环退出

内外层各有一个关闭标记（`isClosed` / `isCancelled`），它们通过不同的事件通路被触发，时序不完全同步。在当前实现中，内层的 `isCancelled` 检查是停止 LLM 消费的关键，外层主要管理 SSE 格式编码管道。

---

## 七、剩余问题（2026-06-27 状态更新）

### 7.1 `useChat()` 多实例化 — ✅ 已解决

V2 架构将 `streamSessions`、`sendingConvIds` 提升为模块级单例。所有 `useChat()` 调用共享同一份状态。详见 [流式架构 V2](2026-06-27-stream-architecture-v2.md)。

### 7.2 `abort()` 与 Store 的耦合不完整 — ✅ 已解决

V2 的 `abort()` 同步调用 `chatStore.finishStreaming()`，不依赖异步 AbortError 传播。

### 7.3 `streamContent` 同样是全局变量 — ⚠️ 接受现状

`streamContent` 仍是 Store 级全局 ref。影响仅限于 UI 显示（`isInitializing` shimmer、流式动画），不导致数据串话。`restoreStreamSession` 中通过 `chatStore.streamContent = session.contentBuffer` 外部赋值恢复正常。

### 7.4 服务端 LLM 流未真正取消 — ✅ 已解决

`ChatOptions` 增加了 `signal?: AbortSignal` 字段。`server/api/chat/index.post.ts` 中创建 `llmAbortController`，`req.on('close')` 触发 abort，Provider 实现层用 signal 取消底层 fetch。详见 [流式架构 V2 §5.3](2026-06-27-stream-architecture-v2.md#53-服务端-abortsignal-支持)。

---

## 八、关键洞察

- **`appendStreamContent` 是盲写**：它只知道"在 messages 最后追加"，不知道 messages 属于哪个对话。`streamingConvId` 给了它"视力"。

- **abort 不等于同步清理**：`AbortController.abort()` 是信号级别的取消——它让 fetch Promise reject，但 reader 缓冲区可能已经读取了数据。在 abort 后、AbortError 被 catch 前，有一个时序窗口。`streamingConvId` 校验是对这个窗口的兜底。

- **三道防线优于两道**：当前有防线一（streamingConvId）和防线二（watch + abort）。如果加上 `consumeSSEStream` 内的 `aborted` 标志检查（在帧解析循环中直接丢弃 abort 后的缓冲帧），可以形成"abort 后立即停止所有帧处理 → streamingConvId 兜底"的更紧密配合。详见后续讨论。

- **状态建模是根本**：`messages` 应该是 `Map<convId, Message[]>`。当前的 `streamingConvId` 修复是在错误模型上打补丁——有效但不优雅。单例化 `useChat()` + 对话绑定 `messages` 是下一步架构演进方向。

---

## 相关文档

- [流式架构 V2 完整文档](2026-06-27-stream-architecture-v2.md) — **本次分析的后续实施**，模块级单例、后台流保持、切回恢复、真正停止
- [流式中断保护方案（原始设计）](2026-06-23-stream-interruption-protection.md) — 两步走策略的最初设计，但根因分析在实施中被修正
- [Sprint A 实施记录](2026-06-23-sprint-a-title-stream-error.md) — 同一轮对话的标题生成与错误态修复
- [Phase 1 审查报告](2026-06-18-phase1-review.md) — 4.2 节 SSE 重连原始改造需求
- [SSE 实现记录](2026-06-03-sse-implementation.md) — 后端两层 ReadableStream 架构
- [对话持久化设计](2026-06-03-conversation-persistence-design.md) — contentBuffer 机制原始设计
- [实施路线图](../../.claude/plan/roadmap.md) — 1.28/1.29/1.30 任务定义
