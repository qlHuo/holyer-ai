# 2026-06-23 — 流式中断保护：增量写入 + 切换清理 + SSE 重连决策

> 核心洞察：SSE 重连（1.17）是伪需求——网络闪断概率低 + 无法"真重连"只能从头生成。真正痛点有两个：导航离开导致流式内容丢失（后端只在流完成后写 DB），切换对话时旧流泄漏到新对话（Store 不 abort 正在进行的请求）。

---

## 讨论背景

Phase 1.5 第二轮剩余任务中，1.17 SSE 重连机制被设计为"指数退避重连 + 断点续传"。深入分析后发现这条需求有三个缺陷：场景极少、无法实现真正重连（后端 LLM 流是一次性的）、即便实现了也只能"从头生成"而非"接上"。

讨论过程中，用户指出了两个**真正高频且破坏性大**的场景：
1. 流式输出中刷新页面或切换对话 → **内容全部丢失**
2. 流式输出中切换对话 → **旧对话内容泄漏到新对话**

---

## 决策一：SSE 重连（1.17）→ 推迟不做

### 两条致命缺陷

**缺陷 1：无法"接上"，只能"重头来"**

```
后端 /api/chat 的 LLM 流是一次性的：

  const llmStream = await llmProvider.chat(allMessages, ...)
  //  ↑ 已经发出的 API 调用，token 在生成
  //  一旦 HTTP 连接断开，llmStream 无法"接上"

  // 所谓"重连"实际就是：
  // → 重新 POST /api/chat → 重新调 LLM → 从头生成
  // → 已生成的 N 个 token 全部浪费
```

要实现真正的断点续传，需要：
- 后端缓冲整个 LLM 输出流（Edge Runtime 内存受限）
- `Last-Event-ID` 协议支持（需要前后端协商）
- LLM 支持从指定位置续生成（目前无一支持）
- SSE 规范 `id:` 字段 + 客户端 `Last-Event-ID` 请求头

这对个人应用来说投入产出比极低。

**缺陷 2：触发场景极少**

桌面端稳定 WiFi 下，一次对话（30s–2min）内发生网络闪断的概率极低。移动端切网络频繁一些，但项目初期只有 Web 端。为低概率事件做一个"自动重试但重头来"的机制，收益抵不上复杂度。

### 结论

> **⏸️ 推迟到 Phase 3+**。如果未来有强需求（如移动端适配），重新评估时优先调研 LLM API 是否原生支持 stream resume。

---

## 决策二：增量写入 DB（替代 1.17，解决数据丢失）

### 问题根因

[server/api/chat/index.post.ts](server/api/chat/index.post.ts) 中，assistant 消息**只在 LLM 流完全结束后才写入数据库**：

```ts
// 当前代码 — 脆弱点
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  contentBuffer += value
  controller.enqueue({ type: SSE_EVENT.TEXT, content: value })
}
// ↓↓↓ 流完全结束才到这里
if (contentBuffer) {
  await addMessages(conv.id, [{ role: 'assistant', content: contentBuffer }])
}
```

用户如果在此之前刷新页面/切走/关标签页：
- HTTP 连接断开
- Cloudflare Worker 的 `ReadableStream.cancel()` 触发
- Worker 可能在毫秒内被终止
- `contentBuffer` 中的内容永远丢失

### 方案：边生成边存

```
改造前：LLM 生成完 → 一次性 INSERT
改造后：LLM 开始前 → INSERT 空占位
        每 200 字符 → UPDATE content
        流结束     → 最终 UPDATE
```

```ts
// 改造后
async start(controller) {
  // ... META 事件 + 标题更新不变 ...

  // ★ 增1：调用 LLM 前先插入空占位
  const [placeholder] = await db.insert(messages).values({
    conversationId: conv.id,
    role: 'assistant',
    content: ''
  }).returning({ id: messages.id })
  const placeholderId = placeholder!.id

  try {
    const llmStream = await llmProvider.chat(allMessages, { ... })
    const reader = llmStream.getReader()
    let contentBuffer = ''
    let lastFlushLen = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      contentBuffer += value
      controller.enqueue({ type: SSE_EVENT.TEXT, content: value })

      // ★ 增2：每 200 字符刷一次 DB
      if (contentBuffer.length - lastFlushLen >= 200) {
        await db.update(messages)
          .set({ content: contentBuffer })
          .where(eq(messages.id, placeholderId))
        lastFlushLen = contentBuffer.length
      }
    }

    // 最终写入（保证完整）
    if (contentBuffer) {
      await db.update(messages)
        .set({ content: contentBuffer })
        .where(eq(messages.id, placeholderId))
    }

    controller.enqueue({ type: SSE_EVENT.DONE, ... })
  } catch (error) {
    // ★ 即使出错，占位消息中的部分内容也已保存
    controller.enqueue({ type: SSE_EVENT.ERROR, content: ... })
  } finally {
    controller.close()
  }
}
```

### 对 regenerate 的影响

当前 regenerate 在流结束后 `deleteLastAssistantMessage` + `addMessages`。改造后变为：先 `deleteLastAssistantMessage`（删旧回复），再 INSERT 空占位，后续流程相同（增量 UPDATE）。

### 为什么是 200 字符？

- 200 字符 ≈ 50–80 个 token，约 1–2 秒的生成量
- 最坏损失：199 个字符，用户基本无感知
- DB 写入频率：每 1–2 秒一次，对 Neon 无压力
- 备选：也可以加 3 秒时间兜底（`Math.min(200 字符, 3s)`），防止慢模型长时间不刷

### 收益

| 场景 | 改造前 | 改造后 |
|------|--------|--------|
| 正常完成 | ✅ 完整保存 | ✅ 完整保存 |
| 用户中途刷新 | ❌ 全部丢失 | ✅ 最近一次刷新的内容在 DB（最多丢 199 字符） |
| 用户中途切换对话 | ❌ 同上 | ✅ 同上 |
| LLM 调用出错 | ❌ 同上 | ✅ 占位消息 + 部分内容保留 |
| Cloudflare 100s 超时 | ❌ 同上 | ✅ 同上 |

**前端无需改动**——`selectConversation` 从 DB 加载消息时，assistant 的 content 字段就是最近一次增量写入的值，正常渲染即可。

---

## 决策三：修复切换对话时内容泄漏

### 问题根因

`useChat` 的 `abortController` 存在闭包内，Store 的三个切换函数都**不 abort 正在进行的请求**：

```ts
// chat.store.ts
async function selectConversation(id: string) {
  messages.value = []        // 清空消息
  // ← 没 abort！旧对话的 SSE 流还在跑
}
async function createConversation(...) {
  messages.value = []        // 同上
}
function startNewChat() {
  currentConvId.value = null
  messages.value = []        // 同上
}
```

**竞态链路**：

```
0.0s  对话 A 正在流式输出 (abortController #1 存活)
      messages.value = [{role:'assistant', content:'今天天气不错...'}]

0.5s  用户点击对话 B → selectConversation('B')
      messages.value = []                           ← 清空
      messages.value = [B的历史消息]                  ← 加载 B

0.6s  对话 A 的 SSE chunk 到达 → appendStreamContent("很适合出游")
      messages.value[last].content = "很适合出游"     ← 写进了 B 的最后一条消息！
```

### 方案：watch currentConvId 自动 abort

```ts
// app/composables/useChat.ts
export function useChat() {
  const chatStore = useChatStore()
  let abortController: AbortController | null = null
  // ... 现有代码 ...

  // ★ 监听对话切换 → 中断正在进行的 SSE 请求
  watch(() => chatStore.currentConvId, (newId, oldId) => {
    if (oldId && newId !== oldId && abortController) {
      abortController.abort()
      // AbortError → handleStreamError 中静默处理
    }
  })
}
```

**为什么是 watch 而不是 Store 直接调 abort？**

`abortController` 是 `useChat` 内部状态（每次请求创建新实例），不属于 Store 的全局状态。Store 不应该知道"有没有正在进行的请求"——它是消息/对话状态的持有者，不是网络请求的管理者。

`watch` 方案把"感知对话切换"和"执行 abort"绑定在 useChat 内部，职责清晰。

### 与增量写入的协同

```
用户流式输出中 → 切换对话或刷新页面
  ├─ 前端 watch 触发 abort → SSE 断开 → 不再向错的消息列表写内容 ✅
  └─ 后端增量写入 → 最后一次 UPDATE 的内容已在 DB 中 ✅
      → 用户回到该对话 → selectConversation → 看到部分回复 ✅
```

两个修复独立生效但协同完美：一个保护前端不乱写，一个保护后端不丢数据。

---

## 关键洞察

- **"重连"是伪需求，真正需要的是"中断保护"**：用户不会在意网络闪断了几秒（这在桌面端极少发生），但在意"我就刷了一下页面内容全没了"。保护数据的优先级远高于保护连接。
- **Store 和 Composable 的职责边界**：`abortController` 是网络请求的生命周期对象，应留在 composable 内。Store 只管理数据状态，通过 `watch` 建立连接——而非让 Store 直接调用 abort。
- **增量写入的粒度权衡**：200 字符是一个经验值——足够频繁以保证数据安全，又不至于对 DB 产生压力。个人应用的 DB 负载不是瓶颈，数据安全性是首要考量。
- **两个修复独立但协同**：切换清理 + 增量写入可以独立实施和验证。但组合后覆盖了"切走"场景的完整链路（前端不乱写 + 后端不丢数据）。

---

## 决策四：两步走实施策略（1.28 + 1.29 先行，后台流保持按需跟进）

### 核心洞察

> **把"流"从"绑定 UI 的短期请求"升级为"绑定对话的独立后台任务"，UI 只是其中一个可插拔的观察窗口。**

当前架构有三个"单流假设"：后端 TEXT 事件不带 `conversationId`（无法路由）、Store 的 `messages` 是全局单数组（旧流写新对话）、useChat 的 `isSending` 是全局锁（一流阻塞全部对话）。简单 abort（决策三）用 10 行消解了"内容泄漏"问题，但没有改变单流假设本身。要支撑"切走后继续跑、切回来接着看"，需要把这三个假设逐一打破。

### 收益曲线：两步的消除范围

```
问题严重度
  ▲
  │  ████████████ 全部内容丢失（现状）         ← 第一步消除
  │  ██████ 内容泄漏到错对话（现状）            ← 第一步消除
  │  ██ 切回来差 199 字符                      ← 第二步消除
  │  █ 切回来看不到流式动画                      ← 第二步消除
  └──────────────────────────> 改动量
     35 行（30 分钟）      120 行（2–3 小时）
```

第一步用极少成本消除了两个"灾难级"问题。第二步的收益在边际上明显变平。

### 第一步（立刻做）：增量写入（1.28）+ 切换 abort（1.29）

#### 1.28 后端 — 改造 `server/api/chat/index.post.ts`

新增 import（第 16 行后）：

```ts
import { db } from '~~/server/db'
import { messages } from '~~/server/db/schema'
import { eq } from 'drizzle-orm'
```

替换 try-catch 块（第 86–126 行）— 核心变化：

```
改造前：LLM 生成完 → 一次性 addMessages()
改造后：INSERT 空占位 → 每 200 字符 UPDATE → 最终 UPDATE
```

```ts
try {
  // regenerate：先删旧 assistant，再插空占位（顺序关键 →
  // deleteLastAssistantMessage 按 createdAt DESC 删最新一条，
  // 若先插占位再删会删错刚插入的占位）
  if (regenerate) {
    await deleteLastAssistantMessage(conv.id)
  }

  // 1. INSERT 空占位 — 流开始前 DB 已有记录
  const [placeholder] = await db.insert(messages).values({
    conversationId: conv.id,
    role: 'assistant',
    content: ''
  }).returning({ id: messages.id })
  const placeholderId = placeholder!.id

  const llmStream = await llmProvider.chat(allMessages, { model, tools, systemPrompt, temperature, maxTokens })
  const reader = llmStream.getReader()
  let contentBuffer = ''
  let lastFlushLen = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    contentBuffer += value
    controller.enqueue({ type: SSE_EVENT.TEXT, content: value })

    // 2. 每 200 字符 UPDATE
    if (contentBuffer.length - lastFlushLen >= 200) {
      await db.update(messages).set({ content: contentBuffer }).where(eq(messages.id, placeholderId))
      lastFlushLen = contentBuffer.length
    }
  }

  // 3. 流结束最终 UPDATE
  if (contentBuffer) {
    await db.update(messages).set({ content: contentBuffer }).where(eq(messages.id, placeholderId))
  }
  controller.enqueue({ type: SSE_EVENT.DONE, conversationId: conv.id })
} catch (error) {
  // 即使出错，占位 + 部分增量内容已在 DB
  controller.enqueue({ type: SSE_EVENT.ERROR, content: error instanceof Error ? error.message : 'LLM调用失败' })
} finally {
  controller.close()
}
```

**regenerate 顺序说明**：`deleteLastAssistantMessage` 按 `ORDER BY createdAt DESC LIMIT 1` 找最新一条。如果先 INSERT 空占位再 delete，删的就是刚插入的占位而非旧 assistant。必须**先删旧的，再插新的**。

`addMessages` import 仍需保留——第 52 行非 regenerate 路径仍用它保存用户消息。只有 assistant 消息的持久化方式变了。

**200 字符为什么合理**：200 字符 ≈ 50–80 token，约 1–2 秒生成量。最坏丢失 199 字符用户基本无感知。不加时间兜底——200 字符本身已在 1-2 秒内自然触发，加 3s 间隔只增复杂度而无实际收益。

#### 1.29 前端 — watch currentConvId 自动 abort

在 `app/composables/useChat.ts` 的 `useChat()` 函数内（第 25 行后）追加：

```ts
// 切换对话时中断正在进行的请求
// abortController 在 useChat 闭包内，Store 无法访问。
// 通过 watch currentConvId 建立"感知切换 → 执行 abort"的桥梁。
watch(() => chatStore.currentConvId, (newId, oldId) => {
  if (oldId && newId !== oldId && abortController) {
    abortController.abort()
    // AbortError → handleStreamError 中静默 finishStreaming
  }
})
```

**边界行为**：`oldId` 为 null（Path B 首次设值）不触发；`newId === oldId` 不触发；`abortController` 为 null（流已结束）不触发。

#### 第一步协同效果

```
用户流式输出中 → 切换对话
  ├─ watch 触发 abort → SSE 断开 → 旧流不再向 messages 写内容  ✅
  └─ 后端增量写入 → 最后一次 UPDATE 已存 DB                    ✅
      → 用户切回对话 → selectConversation → 看到部分回复         ✅
```

改动量 35 行，两个文件，互不依赖可并行。

---

### 第二步（按需跟进）：后台流保持 + 切回续显

第一步用 35 行消除了全部丢失和内容泄漏两个灾难问题。剩余差距：切回对话时差最后 0–199 字符（DB 最近一次增量写入后新生成的部分），以及没有流式动画。

第二步把"流"从"绑定 UI 的短期请求"重构为"绑定对话的独立后台任务"。需要改动 5 个文件约 120 行。

#### 前提条件：打破三个"单流假设"

| # | 位置 | 单流假设 | 第二步如何打破 |
|---|------|---------|--------------|
| 1 | 后端 SSE 事件 | TEXT 事件不带 `conversationId` | 每个事件加 `conversationId: conv.id`（3 行） |
| 2 | Store `messages` | 全局单数组，切换时全量替换 | `selectConversation` 支持 `skipLoad` + `presetMessages` |
| 3 | useChat `isSending` | 全局锁，一流阻塞全部对话 | 改为 `sendingConvIds: Set<string>`，每对话独立锁 |

#### 核心数据结构（useChat 内部）

```ts
interface StreamSession {
  abortController: AbortController
  contentBuffer: string       // 完整累计（比 DB 增量写入新最多 199 字符）
  error: string | null
  isActive: boolean
}

// 多流会话表 — 每个对话最多一个活跃流
const streamSessions = new Map<string, StreamSession>()

// 每对话发送锁 — 替代全局 isSending
const sendingConvIds = ref(new Set<string>())
```

#### sendMessage 流程变化

```
第一步：sendMessage → await fetch → await consumeSSEStream(阻塞) → finally 清理

第二步：sendMessage → 创建 Session → 启动后台读取(fire-and-forget) → 立即返回
         用户切走不受影响，旧流在后台继续读
```

#### handleSSEEvent 路由逻辑

```ts
// 每个 TEXT chunk 按 convId 路由：
if (payload.type === SSE_EVENT.TEXT) {
  session.contentBuffer += payload.content
  // 只有当前前台对话才写 UI
  if (chatStore.currentConvId === sessionKey) {
    chatStore.appendStreamContent(payload.content)
  }
  // 后台对话：只累积到 session.contentBuffer，不动 UI
}
```

#### switchConversation — 切回时恢复

```ts
async function switchConversation(id: string) {
  const session = streamSessions.get(id)
  if (session?.isActive) {
    // 从 DB 加载历史消息（获取 provider/model/已完成消息）
    const data = await ConversationApi.getDetailById(id)
    const msgs = data.messages
    // 用 session 完整 buffer 替换 DB 中落后最多 199 字符的版本
    const last = msgs[msgs.length - 1]
    if (last?.role === 'assistant') {
      last.content = session.contentBuffer
    } else if (session.contentBuffer) {
      msgs.push({ role: 'assistant', content: session.contentBuffer })
    }
    // 跳过 DB 加载，直接注入 + 恢复流式状态
    chatStore.selectConversation(id, {
      skipLoad: true, presetMessages: msgs,
      presetProvider: data.provider, presetModel: data.model,
      presetStreamState: { isStreaming: true, isInitializing: false }
    })
  } else {
    await chatStore.selectConversation(id)  // 正常 DB 加载
  }
}
```

#### Store 改动（chat.store.ts）

`selectConversation` 增加可选参数 `skipLoad` + `presetMessages`。不传参时行为完全不变，向后兼容。

#### 调用方改动（LayoutSidebar.vue）

`chatStore.selectConversation(id)` → `useChat().switchConversation(id)`（1 行替换）。

#### 第二步的额外风险

**并发 LLM 调用费用**：用户快速切多个对话分别发消息 → 多个流同时跑 → N 倍 token 消耗。第一步的 abort 策略天然避免了这个问题；第二步释放了它。缓解：侧边栏项脉冲动画标记活跃流 + 顶栏"N 个对话正在生成中"提示，不做硬限制（个人应用用户自行感知成本）。

---

### 两步决策框架

| 维度 | 第一步 | 第二步 |
|------|--------|--------|
| 改动量 | 2 文件 ~35 行 | 5 文件 ~120 行 |
| 时间 | 30 分钟 | 2–3 小时 |
| 消除的问题 | 全部内容丢失 + 内容泄漏 | + 199 字符差距 + 无流式动画 |
| 新增风险 | 无 | 并发 LLM 调用费用、多流 bug 调试成本 |
| 何时做 | **立刻** | 第一步上线后，用真实体验判断 199 字符差距是否可感知，再决定 |

---

## 相关文档

- [Phase 1 审查报告](2026-06-18-phase1-review.md) — 4.2 节 SSE 重连原始改造需求
- [Sprint A 实施记录](2026-06-23-sprint-a-title-stream-error.md) — 同一轮对话的标题生成与错误态修复
- [对话持久化设计](2026-06-03-conversation-persistence-design.md) — contentBuffer 机制原始设计
- [SSE 实现记录](2026-06-03-sse-implementation.md) — 后端 SSE 工具细节
- [实施路线图](../../.claude/plan/roadmap.md) — Phase 1.5 第二轮任务清单

---

## 实施后记（2026-06-24 ~ 2026-06-25）

> 第一步（1.28 + 1.29）实施完成后，用户反馈了实际运行中的串话 bug，促使对根因进行了更深入的分析。

### 根因修正：决策三的分析不完整

原"决策三"将内容泄漏的根因归结为 **"Store 的三个切换函数都不 abort 正在进行的请求"**。这在链路层面是正确的——abort 确实缺失——但**深层根因不在这里**。

真正的根因是 **`messages` 是全局单数组，与对话无绑定关系**（详见 [流式串话根因分析](2026-06-25-stream-leakage-root-cause.md)）：

```
appendStreamContent 盲写 messages[last]
  → 不关心 messages 此刻属于哪个对话
  → 旧流 chunk 写入新对话的最后一条消息
```

即使 abort 完美工作（watch 触发 → fetch 取消 → 不再有新 chunk），`reader.read()` 在 abort 前可能已从网络缓冲区读取了数据（"僵尸帧"）。这些帧在 abort 后仍被处理，写入已被替换的 `messages` 数组。

### 新增修复：`streamingConvId` 校验（原设计未包含）

在 Store 层增加了 `streamingConvId` 防线——`appendStreamContent` 执行前校验 chunk 归属的对话 ID 是否与当前对话一致。这是**最后一道防线**：不依赖 abort 时序，只看归属。

修改文件：
- `app/stores/chat.store.ts` — 新增 `streamingConvId` ref + 四个关键时机的读写 + Path B 桥接逻辑

### 新发现：`useChat()` 多实例化问题

实施过程中发现 `useChat()` 在 ChatInput、ChatMessageActions、ChatPanel 三个组件中分别被调用，各自拥有独立的 `abortController`、`isSending`、`watch`。这导致状态分片——ChatInput 的停止按钮无法停止 ChatMessageActions 发起的 regenerate 流。当前因巧合未暴露（只有 ChatInput 发消息、只有它显示停止按钮），但架构脆弱。

详见 [流式串话根因分析 §四](2026-06-25-stream-leakage-root-cause.md#四根因二放大缺陷usechat-三次独立实例化)。

### 文档修正说明

| 原文档段落 | 问题 | 修正 |
|-----------|------|------|
| 决策三 问题根因 | "Store 的三个切换函数都不 abort" | 这是**链路错误**，深层根因是 `messages` 全局单数组 + `appendStreamContent` 盲写 |
| 决策三 方案 | "watch currentConvId 自动 abort" | watch + abort 是**必要但不充分**的。增加了 `streamingConvId` 校验作为兜底 |
| 两步协同效果 | 前端 watch abort + 后端增量写入 | 实际是**三道防线**：watch abort → streamingConvId 校验 → 增量写入保底 |

### 相关新文档

- [流式串话根因深度分析](2026-06-25-stream-leakage-root-cause.md) — 两道防线、多实例问题、三层 ReadableStream 架构的完整分析

---

## 实施后记（2026-06-26 ~ 2026-06-27）— 第二步实施 + 完整的 V2 架构

> 原计划"第一步立刻做、第二步按需跟进"。实际实施中将两步合并为一次完整的架构升级，交付了超出设计的改进。

### 1.30 被实施（而非推迟）

用户在第一步上线后反馈了预期行为：切换对话不应停止旧流，切回来应恢复实时输出。这与原设计第二步的目标完全一致，因此 1.30 被提前实施。

### 完整改动

| 文件 | 改动内容 | 行数 |
|------|---------|:--:|
| `app/composables/useChat.ts` | 模块级 `streamSessions` + `sendingConvIds`；`restoreStreamSession`；`switchConversation`；`abort()` 精准停止；`isSending` 按对话 computed；handleSSEEvent 按 convId 路由；META re-key；第二层 aborted 标志 | ~347 |
| `app/stores/chat.store.ts` | `SelectConversationOptions` 接口（skipLoad/presetMessages/presetProvider/presetModel）；`selectConversation` 支持注入路径 | ~171 |
| `server/api/chat/index.post.ts` | `llmAbortController` + `AbortSignal`；所有事件加 `conversationId`；增量写入 DB；`isCancelled` 检查；AbortError 处理 | ~79 |
| `server/service/conversation/mutations.ts` | 新增 `insertMessage`、`updateMessage` | +42 |
| `shared/types/conversation.ts` | 新增 `MessageDetail` | +11 |
| `shared/types/provider.ts` | `ChatOptions.signal` | +2 |
| `shared/types/sse.ts` | 事件注释完善 | +10 |
| `server/utils/sse.ts` | AbortError 静默退出 | +4 |
| `app/components/layout/LayoutSidebar.vue` | 使用 `switchConversation` 替代 `chatStore.selectConversation` | ~5 |

### 实现与设计的差异

| 设计 | 实现 | 原因 |
|------|------|------|
| 两步分开（第一步 35 行，第二步 120 行） | 合并为一次重构 | 共享数据结构，分开实施需两次重构 |
| `watch currentConvId` 自动 abort | `switchConversation` 保留旧流 | 切换 ≠ 停止 |
| 后端无 `AbortSignal` | `llmAbortController` + `ChatOptions.signal` | 真正停止 LLM，避免 token 浪费 |
| `useChat` 内 AbortController 单变量 | 模块级 `streamSessions` Map | 支持多对话同时流式 |
| `isSending: ref(false)` | `computed` → `sendingConvIds` Set | 按对话隔离 |

### 新增能力

- **真正停止**：`abort()` → HTTP 断开 → 服务端 `isCancelled=true` → 停止 LLM API 调用 + DB 写入
- **后台流保持**：切换对话时旧流继续后台运行（TEXT 累积到 buffer，写入 DB）
- **切回恢复**：`restoreStreamSession` → DB 历史 + buffer 补丁 → 实时继续流式输出
- **多路并行**：每个对话独立流，`isSending` 按对话隔离，不互相阻塞
- **三层防线**：abort fetch → aborted 标志检查 → `streamingConvId` Store 校验

详见 [流式架构 V2 完整文档](2026-06-27-stream-architecture-v2.md)。
