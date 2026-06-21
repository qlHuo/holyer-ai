# 2026-06-22 — 消息重新生成功能设计

> 重新生成不能靠前端复用 sendMessage 来实现——需要后端新增 `regenerate` 参数，改变消息保存和上下文构建的行为。

---

## 讨论背景

Phase 1.5 第二轮（交互兜底 + 功能补全）中 [1.19 消息操作按钮](../.claude/plan/roadmap.md)，需求是 hover 在 assistant 消息上时显示"重新生成"按钮。

最初的想法是在前端直接拿最后一条用户消息重新调用 `sendMessage()`，但这会导致：
1. 前端 messages 列表中新增一条**重复的用户消息**
2. 后端 `addMessages` 再存一条相同的 user 消息到数据库
3. 创建新 assistant 占位而非替换旧回复

正确的语义是：**用户消息不变，只有 assistant 回复被替换**。

---

## 核心结论

### 正常发送 vs 重新生成：三步差异

| 步骤 | 正常发送 | 重新生成 |
|:--:|------|------|
| 保存消息 | `addMessages(conv.id, message)` 存入新用户消息 | **跳过**——用户消息已在 DB 中 |
| 构建上下文 | `[...conv.messages, ...message]` 历史 + 新消息 | `conv.messages` 去掉最后一条旧的 assistant |
| 保存回复 | `addMessages` INSERT 新 assistant | 先 DELETE 旧的 assistant，再 INSERT 新的 |

### 方案选型：为什么选 B

| 方案 | 核心思路 | 评价 |
|:--:|------|------|
| A | 前端兼容——不修改 sendMessage 行为，调用时传 message: [] | DB 中会多一条重复用户消息，UI 虽不漏但数据脏 |
| B | **后端加 `regenerate` 参数**——跳过存用户消息，上下文剔除旧回复 | 最干净，但需要后端配合 |
| C | 暂不做重新生成，消息操作只做复制 | Phase 1 足够，但功能不完整 |

选择 **B**——改动量可控（~50 行净增），且语义正确。

### 竞态陷阱（已修正）

初始设计中，流结束后并行执行 delete 和 insert：

```ts
// ❌ 有竞态：insert 可能比 delete 内部的 SELECT 先完成
await Promise.all([
  deleteLastAssistantMessage(conv.id),  // 内部：SELECT → DELETE
  addMessages(conv.id, [...])           // INSERT
])
```

`deleteLastAssistantMessage` 内部逻辑是"**查出最新一条** → 删掉"。如果 INSERT 在 SELECT 之前提交，最新一条就变成了刚插入的新回复，然后被删掉——结果是旧的不在、新的没了。

**修正为顺序执行：**

```ts
// ✅ 先删旧的，再插新的——不存在时序问题
await deleteLastAssistantMessage(conv.id)
await addMessages(conv.id, [{ role: 'assistant', content: contentBuffer }])
```

### 为什么不用 UPDATE 替代 DELETE + INSERT

另一种思路是直接 UPDATE 旧 assistant 的 content 字段，一条 SQL 完成无竞态。但：
- 需要新增 `updateLastAssistantMessage` 函数，且需要拿到旧消息的 DB id
- 消息 id 变更更加"诚实"——它确实是新生成的内容
- 当前没有依赖消息 id 的逻辑，但保留扩展空间

**保持顺序删 + 插**——最简单、最清晰。

### `deleteLastAssistantMessage` 实现要点

```ts
export async function deleteLastAssistantMessage(conversationId: string): Promise<void> {
  // 1. 按 created_at DESC 找到最新消息
  const [lastMsg] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(1)

  // 2. 有则删除（无消息时静默成功）
  if (lastMsg) {
    await db.delete(messages).where(eq(messages.id, lastMsg.id))
  }
}
```

`getHistory()` 返回的 `Message[]` 不含 DB `id`（它映射到 `shared/types/provider.ts` 的 `Message` 接口），所以需要独立查询一次 `messages` 表获取最新消息的 id。

---

## 涉及文件

| # | 文件 | 改动 |
|---|------|------|
| 1 | `server/api/chat/schema.ts` | 新增 `regenerate: z.boolean().optional()`，用 `.refine()` 替代 `.min(1)` 做条件校验 |
| 2 | `server/api/chat/index.post.ts` | 三步分叉：跳过存用户消息、上下文剔除旧回复、顺序删旧插新 |
| 3 | `server/service/conversation/mutations.ts` | 新增 `deleteLastAssistantMessage()` |
| 4 | `server/service/conversation/index.ts` | 导出新函数 |
| 5 | `app/api/chat.ts` | `ChatRequest` 接口新增 `regenerate?: boolean` |
| 6 | `app/composables/useChat.ts` | 抽取 `consumeSSEStream()` / `handleStreamError()` 公共函数；新增 `regenerate()` |
| 7 | `app/components/chat/MessageActions.vue` | 1.19 的一部分——调用 `regenerate()` 的 UI 入口 |

`app/stores/chat.store.ts`、`shared/types/`、`server/utils/sse.ts` 无需改动——现有语义完全兼容重新生成流程。

---

## 边界情况

| 场景 | 行为 |
|------|------|
| 最后一条不是 assistant | `regenerate()` 直接 return |
| 对话无消息（极端情况） | `deleteLastAssistantMessage` 查到 0 条，静默成功 |
| LLM 调用中途失败 | 旧 assistant 已从 UI 移除但 DB 中仍保留，刷新后恢复——可接受的降级 |
| 用户快速连点"重新生成" | `isSending` 守卫，第二次点击无效 |
| 重新生成时点"停止" | `abort()` 触发 `AbortError`，与正常发送行为一致 |

---

## 关键洞察

- **"重新生成"不是"再发一次"**——它不需要新用户消息，只需要替换旧回复。把两者混为一谈会导致数据冗余和 UI 异常
- **"查最新再删"的竞态只在并行时成立**——单请求内顺序执行，同一个对话没有其他并发写入者，不需要事务也能保证正确性
- **后端改三步中只有"删旧 assistant"需要新函数**——"不存用户消息"和"上下文剔除"都是纯逻辑分叉，不增加新的 DB 操作

## 相关文档

- [Phase 1 审查报告](2026-06-18-phase1-review.md) — 1.19 消息操作按钮
- [实施路线图](../../.claude/plan/roadmap.md) — Phase 1.5 第二轮
- [对话持久化设计](2026-06-03-conversation-persistence-design.md) — 消息保存与 addMessages 设计
