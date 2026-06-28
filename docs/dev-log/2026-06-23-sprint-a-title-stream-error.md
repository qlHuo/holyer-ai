# 2026-06-23 — Sprint A 实施：对话标题生成与流式错误态

> 核心洞察：看似简单的"首条消息做标题"需求，暴露了对话创建流程中 Path A / Path B 两条路径的不对称性——`setCurrentConvId` 的 `if (!existing)` 分支在 Path A 下永远不会执行，是死代码。

---

## 讨论背景

Phase 1.5 Sprint A 实施过程中，发现所有对话列表项标题都显示"新对话"，无论是否有实际问答内容。需要实现：首条用户消息自动成为对话标题。

这个需求涉及三条链路协同：
1. **后端 chat handler**：检测首条消息 → 裁剪标题 → 更新 DB → 通过 META 事件发给前端
2. **前端 META handler**：接收标题并更新对话列表
3. **Store `setCurrentConvId`**：将新对话注册到列表

看似简单的改动，但深入分析后发现 `setCurrentConvId` 的逻辑存在根本性的理解偏差。

---

## 核心结论

### 1. 两条创建路径的不对称性

对话创建存在两条路径，`setCurrentConvId` 的行为完全不同：

```
Path A（正常流程）：
  点击"新建对话" → POST /api/conversations → createConversation()
  → 对话已加入列表 + currentConvId 已设置
  → 用户输入消息 → POST /api/chat → getOrCreateConversation 命中查询分支
  → META 事件返回时 currentConvId 不为 null → META handler 直接跳过
  → setCurrentConvId 永不调用

Path B（直接发送）：
  currentConvId 为 null → POST /api/chat → getOrCreateConversation 命中创建分支
  → META 事件返回时 currentConvId 为 null → META handler 命中条件
  → setCurrentConvId 被调用 → unshift 到列表
```

**关键发现**：`setCurrentConvId` 的唯一调用点 `useChat.ts` META handler 有条件 `!chatStore.currentConvId`，而 Path A 下该值已在 `createConversation()` 中设置。因此 Path A 下对话一直在列表中，但标题始终是初始值 `'新对话'`。

### 2. `setCurrentConvId` 的死代码

```ts
// 原代码
function setCurrentConvId(id: string, title?: string) {
  currentConvId.value = id
  const existing = conversations.value.find(c => c.id === id)  // ← 永远为 null
  if (existing) {
    // 永远不执行——Path A 不调用此函数，Path B 对话不在列表中
    existing.title = title || existing.title
  } else {
    conversations.value.unshift({ ... })
  }
}
```

调用方条件 `!chatStore.currentConvId` 保证了此时对话不可能已在列表中（`currentConvId` 为 null 意味着用户还没在这个对话中，而列表内容来自 `loadConversations`，两者不同步但新对话 ID 是后端刚生成的 UUID，不可能匹配）。`if (!existing)` 是死分支。

**正确的做法**：函数只负责 unshift，不需要 find 防重。标题更新应该由调用方通过 `updateConversationItem` 完成。

### 3. 修复方案：META handler 同时覆盖两条路径

```ts
// useChat.ts — META handler
case SSE_EVENT.META:
  if (payload.conversationId) {
    if (!chatStore.currentConvId) {
      // Path B：对话不在列表中，先添加
      chatStore.setCurrentConvId(payload.conversationId, payload.title as string | undefined)
    }
    // Path A & B：更新列表中的标题（已存在的原地更新，刚添加的二次确认）
    chatStore.updateConversationItem(payload.conversationId, {
      title: payload.title as string
    })
  }
  break
```

`updateConversationItem` 用 `findIndex`，找不到就 no-op。Path B 下刚 unshift 的条目会被二次更新，无副作用。

### 4. 后端 chat handler 改动

```ts
// server/api/chat/index.post.ts

// getOrCreateConversation 之后，保存消息之前
const isFirstMessage = conv.messages.length === 0
const title = isFirstMessage
  ? (message[0]?.content?.slice(0, 50) || '新对话')
  : conv.title

// ReadableStream start() 中：
controller.enqueue({ type: SSE_EVENT.META, conversationId: conv.id, title })

// 首条消息 → 先更新 DB 标题，再调 LLM
if (isFirstMessage) {
  try {
    await updateConversationById(conv.id, { title })
  } catch {
    // 标题更新失败不阻塞对话
  }
}
```

为什么用 `conv.messages.length === 0` 而非 `!conversationId`？
- `conversationId` 只表示"前端是否传了 ID"，不代表"对话是否有历史"
- Path A 下前端传了刚创建的对话 ID，但 messages 为空
- `messages.length === 0` 在所有路径下都准确表达"这是第一条消息"

### 5. `updateConversationById` Service

新增最小的更新函数，只允许修改 title / model / provider：

```ts
// server/service/conversation/mutations.ts

export async function updateConversationById(
  id: string,
  data: { title?: string; model?: string; provider?: string }
): Promise<void> {
  await db
    .update(conversations)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(conversations.id, id))
}
```

为什么不用 `ConversationDetail` 类型？
- `ConversationDetail` 包含 `messages`、`createdAt`（ISO string）、`updatedAt`（ISO string）——这些都不应通过 update 修改
- 窄类型更安全，调用方不会误传不该改的字段
- `updatedAt` 自动刷新为 `new Date()`

---

## 流式错误态相关修复

同一轮 Sprint A 还修复了两个流式相关的 bug：

### `isInitializing` 模式

**问题**：流式光标（闪烁指示器）需要在"等待首个 token"时显示，一旦有内容返回就隐藏。原先用 `isStreaming` 控制，但 `appendStreamContent` 中误设为 `false` 导致整个流式状态混乱。

**方案**：新增 `isInitializing` ref，语义明确分离：

| ref | 含义 | 何时 true | 何时 false |
|-----|------|----------|-----------|
| `isInitializing` | 等待首个 token | `startStreaming()` | `appendStreamContent()` 首次调用 |
| `isStreaming` | 正在流式接收 | `startStreaming()` | `finishStreaming()` |

`appendStreamContent` 中设置 `isInitializing.value = false` —— 只在首个 chunk 到达时触发一次，后续 chunk 重复设 false 无副作用。

### `streamError` 生命周期

**问题**：`finishStreaming()` 中原有 `streamError.value = null`，导致错误被设置后立即清空。前端永远看不到错误态。

**修复**：`streamError` 只在以下时机清除：
- `startStreaming()` — 新请求开始
- `selectConversation()` — 切换对话
- `startNewChat()` — 开启新对话
- `SSE_EVENT.DONE` — 正常完成

`finishStreaming()` 不再清除 `streamError`，确保错误态持续到下一个动作。

---

## 关键洞察

- **META 事件的两个消费方不对称**：Path A 下 META 事件的 `conversationId` 被条件跳过（`!currentConvId` 为 false），但 `title` 仍然需要被消费。原始设计只考虑了 Path B。
- **`messages.length === 0` 比 `!conversationId` 更可靠**：前者反映数据库真实状态，后者只反映前端传参。regenerate 设计中也用了类似的"检查最后一条消息角色"模式。
- **条件守卫本身会暴露设计假设**：`!chatStore.currentConvId` 这个条件隐含了"只有新对话才需要处理 META"的假设，但这个假设在标题需求面前不成立。
- **Store 函数的"防重"逻辑要有依据**：`setCurrentConvId` 的 `find` 防重看起来稳健，但放在调用链中看却是死代码。防重逻辑应该在真正存在重复风险的场景写，而不是每个函数都加一遍。

---

## 相关文档

- [对话持久化设计](2026-06-03-conversation-persistence-design.md) — META 事件机制原始设计
- [消息重新生成设计](2026-06-22-regenerate-design.md) — 同一条 chat handler 的前一次改造
- [Phase 1 审查报告](2026-06-18-phase1-review.md) — Sprint A 任务来源
- [流式中断保护方案](2026-06-23-stream-interruption-protection.md) — 同日讨论的增量写入 + 切换清理 + SSE 重连决策
- [实施路线图](../../.claude/plan/roadmap.md) — Phase 1.5 第二轮任务清单
