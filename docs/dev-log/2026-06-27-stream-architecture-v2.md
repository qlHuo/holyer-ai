# 2026-06-27 — 流式架构 V2：从"绑定 UI 的请求"到"绑定对话的后台任务"

> 核心洞察：流不是"正在加载的一次性网络请求"，而是"绑定到对话的独立后台任务"——UI 只是其中一个可插拔的观察窗口。V2 架构实现了这个转变：切换对话时旧流继续后台运行，切回来恢复实时输出，手动停止真正终止（服务端停止 LLM + DB 写入）。

---

## 零、V1 → V2 概览

```
V1（全局锁 + 无恢复能力）              V2（按对话隔离 + 完整恢复路径）

isSending: ref(false)  全局锁         isSending: computed → sendingConvIds Set（按对话）
abortController: 单变量               streamSessions: Map<convId, StreamSession>（按对话）
切换 = 看 watch 有没有 abort          切换 = 保留旧流 + 恢复新流（switchConversation）
停止 = abort fetch，可能停错          停止 = abort fetch → 服务端检测 → 停止 LLM + DB
切回 = 空壳，什么都没恢复             切回 = DB 历史 + buffer 补丁 → 实时继续
后端 TEXT 不带 convId                后端所有事件带 convId（多路路由）
LLM 无法取消                          AbortSignal 传入 Provider → 真正取消
```

---

## 一、架构拓扑

```
module-level (模块级单例，全局唯一)
┌────────────────────────────────────────────────────────┐
│  streamSessions: Map<convId, StreamSession>            │
│  sendingConvIds: ref<Set<string>>                     │
│                                                         │
│  所有 useChat() 调用共享上述状态，保证：                  │
│  - ChatInput 的停止按钮可停止 ChatMessageActions 的流    │
│  - ChatPanel 的 isSending 与 ChatInput 看到同一个值      │
└──────────────┬──────────────────────────────────────────┘
               │
    ┌──────────┼──────────┬──────────────┐
    │          │          │              │
    ▼          ▼          ▼              ▼
ChatInput  ChatMessage  ChatPanel   LayoutSidebar
isSending  isSending   error        switchConversation
sendMsg    regenerate               (切换入口)
abort      (重新生成)
(发送)
```

**关键设计决策**：`streamSessions` 和 `sendingConvIds` 在 `useChat()` 函数外部声明，不依赖 Pinia。`useChatStore()` 的获取延迟到 `useChat()` 函数体内——避开模块加载时 Pinia 尚未初始化的问题。

---

## 二、核心数据结构

### 2.1 StreamSession（流会话）

```ts
// app/composables/useChat.ts
interface StreamSession {
  convId: string               // 对话 ID（新对话临时为 '__pending__'）
  abortController: AbortController  // 取消控制器
  contentBuffer: string        // 完整累计（比 DB 增量写入新最多 199 字符）
  isActive: boolean            // 是否仍在运行
}

/** 所有活跃流 — 每个对话最多一个 */
const streamSessions = new Map<string, StreamSession>()

/** 活跃流的对话 ID 集合 — isSending 按此判断 */
const sendingConvIds = ref(new Set<string>())
```

### 2.2 `isSending` — 按对话计算

```ts
const isSending = computed(() => {
  const convId = chatStore.currentConvId
  return convId
    ? sendingConvIds.value.has(convId)
    : sendingConvIds.value.has('__pending__')  // Path B 新对话
})
```

每个 `useChat()` 调用创建自己的 `computed` 实例，但所有实例读取同一个 `sendingConvIds` ref——计算结果一致，内存开销多一个 computed ref（~几十字节）。

### 2.3 Store 中的 `SelectConversationOptions`

```ts
// app/stores/chat.store.ts
interface SelectConversationOptions {
  skipLoad?: boolean           // 跳过 DB 加载（restoreStreamSession 使用）
  presetMessages?: Message[]   // 预设消息列表
  presetProvider?: string      // 预设 provider
  presetModel?: string         // 预设 model
}
```

这是 `restoreStreamSession` 的关键依赖：切换回有活跃流的对话时，消息列表不是从 DB 加载后直接使用（DB 落后最多 199 字符），而是由调用方用 buffer 补丁后的数据注入。

---

## 三、核心行为

### 3.1 `sendMessage` / `regenerate` — 发起流

```
sendMessage(content)
  ├─ guard: isSending 检查（sendingConvIds.has(convId)）
  ├─ chatStore.addMessage(userMsg)          // UI 立即显示用户消息
  ├─ chatStore.startStreaming()             // isStreaming=true, streamContent=''
  ├─ 创建 StreamSession → streamSessions.set(key, session)
  ├─ sendingConvIds.add(key)
  ├─ fetch /api/chat
  ├─ consumeSSEStream(response, session)    // 阻塞直到流结束
  └─ finally: cleanupSession(session)       // Map.delete + Set.filter
```

**Path B 特殊处理**：当 `currentConvId` 为 `null`（用户未先创建对话直接发消息），session key 使用 `'__pending__'` 临时占位。META 事件到达后 re-key 为真实 ID。

### 3.2 `abort()` — 真正停止（完整链路）

```
用户点击"停止"
  │
  ▼
abort()
  ├─ streamSessions.get(currentConvId)     // 找到当前对话的 session
  ├─ session.abortController.abort()       // ★ 第一层：abort fetch
  ├─ chatStore.finishStreaming()           // 同步清理 UI（不等异步传播）
  └─ cleanupSession(session)              // 移除 session 注册
      │
      ▼  ─────── 网络断开 ───────
      │
      ▼
server/api/chat/index.post.ts
  ├─ req.on('close') → isCancelled = true  // Nitro 检测到客户端断开
  ├─ llmAbortController.abort()           // ★ abort LLM API 调用
  │   └─ signal 传入 llmProvider.chat()
  │       └─ Provider 内部 fetch 被取消 → AbortError
  ├─ while 循环中 isCancelled 检查 → break  // 停止读流 + DB 写入
  └─ 不发送 DONE 事件
```

**关键改进**：V1 中 `abort()` 只取消前端 fetch，服务端 LLM 调用继续运行直到自然结束。V2 增加了 `llmAbortController` + `ChatOptions.signal`，形成完整取消链。

### 3.3 `switchConversation(id)` — 切换对话（唯一入口）

```
switchConversation(id)
  ├─ streamSessions.get(id)               // 检查目标是否有活跃流
  │
  ├─ [有活跃流] → restoreStreamSession(id)  // DB 历史 + buffer 补丁
  │   └─ 竞态 fallback: 如果 restore 期间流恰好结束
  │       restoreStreamSession 提前 return（session 已被 cleanupSession 移除）
  │       → 检查 currentConvId !== id → selectConversation(id) 正常加载
  │
  └─ [无活跃流] → chatStore.selectConversation(id)  // 正常 DB 加载
```

旧对话的流不受影响——继续后台运行，TEXT chunk 累积到 `session.contentBuffer` 但不写 UI（见 4.2 路由规则）。

### 3.4 `restoreStreamSession(id)` — 切回时恢复实时输出

```
restoreStreamSession(convId)
  ├─ streamSessions.get(convId)            // 二次确认 session 仍在
  │   └─ 若 session 不存在或已结束 → return（竞态保护）
  │
  ├─ ConversationApi.getDetailById(convId)  // 1. 从 DB 加载消息
  │   └─ DB 中最后一条 assistant 可能落后 0-199 字符
  │
  ├─ 2. 用 session.contentBuffer 替换最后一条 assistant 的 content
  │   └─ contentBuffer 是实时累积的，比 DB 更新
  │
  ├─ 3. chatStore.selectConversation(convId, {
  │     skipLoad: true,                    // 不重复加载 DB
  │     presetMessages: msgs,              // 注入补丁后的消息
  │     presetProvider: data.provider,
  │     presetModel: data.model
  │   })
  │
  └─ 4. chatStore.streamContent = session.contentBuffer
      └─ 后续 TEXT 事件在此之上继续累加
```

**为什么需要 buffer 补丁**：后端每 200 字符增量写 DB，在两次写入之间新生成的字符只在 `session.contentBuffer` 中。数据库最多落后 199 字符。用 buffer 替换 DB 中的旧值确保切换回来时看到的是完整内容。

---

## 四、SSE 事件路由

### 4.1 三层防线

```
SSE chunk 到达
  │
  ▼
第一层：abort() → AbortController.abort()
  ├─ fetch Promise reject → consumeSSEStream 的 catch 捕获 AbortError
  │   （大多数 chunk 在此被拦截）
  │
  ▼ （极少数 buffer 残留帧绕过）
第二层：consumeSSEStream 内 aborted 标志
  ├─ abort 事件监听器设置 aborted = true
  ├─ while 循环顶部 + read() 后双重检查
  └─ 丢弃残留帧
  │
  ▼ （极端边缘情况仍能到达）
第三层：Store 层 streamingConvId 校验
  └─ appendStreamContent 内检查 streamingConvId === currentConvId
```

### 4.2 事件按 conversationId 路由

```ts
// app/composables/useChat.ts — handleSSEEvent
switch (payload.type) {
  case SSE_EVENT.META:
    // Path B re-key: '__pending__' → 真实 ID
    // 同步更新 streamSessions + sendingConvIds
    break

  case SSE_EVENT.TEXT:
    session.contentBuffer += payload.content           // ★ 始终累积
    if (eventConvId === chatStore.currentConvId) {     // ★ 仅前台写 UI
      chatStore.appendStreamContent(payload.content)
    }
    break

  case SSE_EVENT.DONE:
    if (eventConvId === chatStore.currentConvId) {     // ★ 仅前台清理
      chatStore.finishStreaming()
      chatStore.streamError = null
    }
    refreshConversationInList(eventConvId)              // 始终刷新列表
    break

  case SSE_EVENT.ERROR:
    if (eventConvId === chatStore.currentConvId) {     // ★ 仅前台显示
      chatStore.streamError = payload.content
      chatStore.finishStreaming()
    }
    break
}
```

**路由规则**：
- TEXT：始终累积到 buffer（切回时需要），但只在当前前台写 UI
- DONE：后台流结束只刷新列表，不清除前台 UI 状态
- ERROR：后台流错误不影响前台对话

---

## 五、服务端改动

### 5.1 SSE 事件携带 conversationId

```ts
// server/api/chat/index.post.ts
controller.enqueue({ type: SSE_EVENT.TEXT, content: value, conversationId: conv.id })
controller.enqueue({ type: SSE_EVENT.DONE, conversationId: conv.id })
controller.enqueue({ type: SSE_EVENT.ERROR, content: '...', conversationId: conv.id })
```

V1 中只有 META 和 DONE 携带 `conversationId`，TEXT 和 ERROR 不携带。V2 中所有事件都携带，前端据此将事件路由到正确的对话。

### 5.2 增量写入 DB

```
LLM 流开始
  ├─ regenerate? → deleteLastAssistantMessage (先删旧的，再插新的)
  ├─ insertMessage(convId, { role: 'assistant', content: '' })  // 空占位
  │
  ├─ while reader.read():
  │   ├─ contentBuffer += value
  │   ├─ controller.enqueue(TEXT)
  │   └─ 每 200 字符 → updateMessage(msgId, { content: contentBuffer })
  │
  └─ 流结束 → updateMessage(msgId, { content: contentBuffer })  // 最终写入
      └─ if !isCancelled → controller.enqueue(DONE)
```

**为什么先删旧的再插新的（regenerate 场景）**：`deleteLastAssistantMessage` 按 `ORDER BY createdAt DESC LIMIT 1` 找最新一条。如果先 INSERT 空占位再 delete，删的就是刚插入的占位而非旧 assistant。

**为什么是 200 字符**：≈ 50–80 token，约 1–2 秒生成量。最坏丢失 199 字符，用户基本无感知。

### 5.3 服务端 AbortSignal 支持

```ts
// server/api/chat/index.post.ts
const llmAbortController = new AbortController()

event.node?.req?.on('close', () => {
  isCancelled = true
  llmAbortController.abort()  // 传递给 Provider
})

const llmStream = await llmProvider.chat(allMessages, {
  ...,
  signal: llmAbortController.signal  // ← 新增
})
```

```ts
// shared/types/provider.ts
export interface ChatOptions {
  // ...existing fields...
  signal?: AbortSignal  // ← 新增
}
```

Provider 实现层用 `signal` 取消底层 LLM API 的 fetch 调用，避免浪费 token。

### 5.4 新增 Service 函数

```ts
// server/service/conversation/mutations.ts
export async function insertMessage(convId, data): Promise<MessageDetail>
export async function updateMessage(messageId, data): Promise<void>
```

`insertMessage` 返回 `MessageDetail`（含 `id`、`createdAt`），用于后续增量 UPDATE。

### 5.5 SSE 工具函数 AbortError 处理

```ts
// server/utils/sse.ts — createSSEResponse
} catch (error) {
  if (error instanceof Error && error.name === 'AbortError') {
    return  // 客户端断开 → 静默退出
  }
  // ...正常错误处理
}
```

---

## 六、META 事件 re-key 机制

新建对话（Path B）时 `currentConvId` 为 `null`，session key 使用 `'__pending__'`：

```
sendMessage（无对话）
  → sessionKey = '__pending__'
  → streamSessions.set('__pending__', session)
  → sendingConvIds.add('__pending__')
    │
    ▼
META 事件到达（携带真实 conversationId）
  → streamSessions.delete('__pending__')
  → session.convId = eventConvId
  → streamSessions.set(eventConvId, session)
  → sendingConvIds: '__pending__' → eventConvId
  → chatStore.setCurrentConvId(eventConvId, title)
  → chatStore.updateConversationItem(eventConvId, { title })
```

**竞态窗口**：如果用户在 META 到达前切走，session key 仍是 `'__pending__'`，无法通过正常的 `switchConversation` 恢复。但 META 是服务端第一个 enqueue 的事件，到达时间 <100ms，用户几乎不可能在此窗口内完成切换操作。

---

## 七、行为矩阵

| 场景 | V1 行为 | V2 行为 |
|------|---------|---------|
| 对话 A 流式中，点停止 | 可能停错流（`abortController` 不精准） | 精准停 A 的流 → 服务端停止 LLM + DB 写入 |
| 对话 A 流式中，切换到 B | A 流继续（但写错 messages），或 watch abort 掉 | A 流继续后台运行，正确写入 DB，不污染 B 的 UI |
| 切回 A（仍在流式） | restoreStreamSession 空壳 → 不恢复 | DB + buffer 补丁 → 实时继续流式输出 |
| A 后台流完成 | finishStreaming() 无条件清除状态 | 仅当前对话才清 UI，后台流只刷新列表 |
| A、B 同时流式，点停止 | 只停最近创建的（或全停） | 只停当前对话的流 |
| isSending（A 流式中） | 全局 true → B 输入框也被锁 | B 输入框独立可用 |
| regenerate（A 流式中） | isSending 可能来自不同实例 | 同一个 sendingConvIds → 正确阻止 |
| 页面刷新（A 流式中） | 内容全部丢失 | 最多丢 199 字符（最后一次增量写入后的部分） |

---

## 八、与设计文档的差异

原 [流式中断保护方案](2026-06-23-stream-interruption-protection.md) 将改造分为两步：第一步 35 行（增量写入 + watch abort），第二步 120 行（后台流保持 + 切回续显，标记为"按需跟进"）。

实际实施中，**两步被合并为一次完整的架构升级**。实现与设计的主要差异：

| 设计 | 实现 | 原因 |
|------|------|------|
| 第二步 1.30 "按需跟进" | 与第一步合并实施 | 两步共享同一套数据结构，分开实施反而需要两次重构 |
| `useChat` 内 AbortController 单变量 | 模块级 `streamSessions` Map | 支持多对话同时流式 |
| `watch currentConvId` 自动 abort | `switchConversation` 保留旧流 | 切换 ≠ 停止，旧流继续后台运行 |
| `isSending: ref(false)` 全局锁 | `computed` → `sendingConvIds` Set | 按对话隔离 |
| 后端无 `AbortSignal` | `llmAbortController` + `ChatOptions.signal` | 真正停止 LLM，避免浪费 token |
| Store `selectConversation` 无参数 | 增加 `SelectConversationOptions` | 支持 `restoreStreamSession` 的注入路径 |
| TEXT 事件不带 `conversationId` | 所有事件带 `conversationId` | 多路路由 |
| 无 META re-key | `__pending__` → 真实 ID | Path B 新对话的 session 身份转换 |

---

## 九、已知局限

### 9.1 Sidebar `handleSelect` 未 await（预存问题，非本次引入）

```ts
function handleSelect(id: string) {
  switchConversation(id)  // ← 没有 await，异常变成 unhandled rejection
  emit('close')
}
```

功能正常——`switchConversation` 内部的异步操作在微任务中执行，不影响 emit close。但网络异常时的错误无法被 `catch` 块捕获。

### 9.2 `chatStore.streamContent` 外部赋值

`restoreStreamSession` 中 `chatStore.streamContent = session.contentBuffer` 是外部代码直接修改 Store 内部 ref。Pinia Setup Store 允许这种写法（ref 自动 unwrap），但从封装性看不理想。Store 可增加 `initStreamContent(value: string)` 方法。

### 9.3 `abort()` 与 `cleanupSession` 双重清理

`abort()` 手动清理 session 后，`consumeSSEStream` 的 finally 中 `cleanupSession` 再次清理。`Map.delete` 对不存在的 key 是 no-op，无害但逻辑有冗余。

### 9.4 Path B 新对话的 META 竞态窗口

如果用户在 META 事件到达前切走（<100ms 窗口），`__pending__` session 无法通过 sidebar 正常恢复。概率极低。

---

## 十、关键洞察

- **流是独立后台任务，UI 只是观察窗口**：这是 V2 架构的核心哲学转变。切换对话不再意味着"停止旧流 + 启动新流"，而是"把视线从 A 移到 B，A 的后台任务继续跑"。

- **三层防线各司其职**：第一层（abort fetch）是主动切断，第二层（aborted 标志）是缓冲区清理，第三层（streamingConvId）是被动兜底。任何一层失效都不会导致串话。

- **`contentBuffer` 是真相来源**：DB 中的内容可能落后 0-199 字符，`session.contentBuffer` 是实时累积的完整内容。`restoreStreamSession` 的核心就是"用真相覆盖快照"。

- **模块级单例解决多实例问题**：V1 中三个 `useChat()` 调用各自拥有独立的 `abortController` 和 `isSending`，依赖巧合保护。V2 将它们提升为模块级变量，所有调用方共享同一份状态。

- **`conversationId` 路由是多路并行的前提**：后端每个 SSE 事件携带 `conversationId`，前端按此将事件路由到正确对话。这是从"单流"升级到"多流"的关键基础设施。

---

## 相关文档

- [流式中断保护方案（原始设计）](2026-06-23-stream-interruption-protection.md) — V2 的设计来源，两步走策略
- [流式串话根因分析](2026-06-25-stream-leakage-root-cause.md) — V1 架构缺陷的深度分析
- [Sprint A 实施记录](2026-06-23-sprint-a-title-stream-error.md) — 标题生成、`isInitializing`、`streamError` 生命周期
- [消息重新生成设计](2026-06-22-regenerate-design.md) — regenerate 功能的前置设计
- [对话持久化设计](2026-06-03-conversation-persistence-design.md) — contentBuffer 机制原始设计
- [SSE 实现记录](2026-06-03-sse-implementation.md) — 后端两层 ReadableStream 架构
- [Phase 1 审查报告](2026-06-18-phase1-review.md) — 4.2 节 SSE 重连原始需求
- [实施路线图](../../.claude/plan/roadmap.md) — 1.28/1.29/1.30 任务定义
