# 2026-08-06 — Agent ReAct + 工具调用已知问题记录

> 基于 2026-08-05 全链路代码审查发现的问题清单。文本闪烁有完整分析，其他问题简要记录。

---

## 讨论背景

在完成 Agent ReAct + 工具调用核心实现后，对 [runner.ts](../../server/service/agent/runner.ts)、[memory.ts](../../server/service/agent/memory.ts)、[api/chat/index.post.ts](../../server/api/chat/index.post.ts)、[useChat.ts](../../app/composables/useChat.ts) 进行了全链路审查，识别出若干可优化点。

---

## 一、文本闪烁问题（详析）

### 问题（现象）

**偶现**。当用户发起对话，LLM 决定调用工具，且恰好先在 `content` 字段中输出了一段引导文本（如"好的，让我来搜索一下"），用户会看到这段文本短暂出现在气泡中，随即被清空，替换为工具调用卡片。

整个链路分四步触发：

1. **Provider 层**：LLM 流式响应中，`delta.content` 的文本 chunk 排在 `delta.tool_calls` 之前到达。Provider 对文本 chunk 是即时 enqueue，对 tool_call delta 是累积后一次性 enqueue。
2. **Runner 层**：[runner.ts:102-106](../../server/service/agent/runner.ts#L102-L106) 读 chunk 时采用"乐观流式"策略——读到 `type: 'text'` 且 `toolCalls.length === 0` 时就 `yield`，读到第一个 `type: 'tool_calls'` 后才停止发出文本。
3. **Runner 层**：循环结束后检测到有 tool_calls，发出 `round_start` 事件。
4. **前端**：[useChat.ts:291](../../app/composables/useChat.ts#L291) 收到 `ROUND_START` 后执行 `streamContent = ''` + `lastMsg.content = ''`，清空已显示的文本。

**用户感知**：文本闪现后消失 → "AI 说了一半又咽回去了"。

### 原因分析

根本原因是 **Runner 在做流式传输时无法预知 LLM 是否会输出 tool_calls**：

- 要流式（低延迟），就必须读到 chunk 就发——但此时不知道后面有没有 tool_calls
- 要知道有没有 tool_calls，就必须读完整个响应——但这就不是流式了

**为什么是偶现**：大多数符合 OpenAI function calling 规范的模型，决定调工具时 `content` 为 `null`，Provider 层不会 enqueue 任何 text chunk。文本闪烁只在模型**同时输出 content 和 tool_calls** 时出现，这取决于模型行为、system prompt 和采样结果。DeepSeek 比 OpenAI 更倾向于先输出引导文本再调工具，但加上了系统提示词中的工具调用准则后，大部分情况下也能抑制这种行为。

> ⚠️ 2026-08-16 更新：本节「暂不处理」的结论已被推翻——用户反馈文本闪烁**仍会复现**（系统提示词抑制不足），已用方案 A 落地修复，见下文「当前决策」。

### 解决方案

#### 方案 A：中间轮全缓冲（简单，加少量延迟）

**思路**：在所有轮次中，完全缓冲 LLM 响应，确认无 tool_calls（最终轮）后才流式发出文本。

```diff
  if (value.type === 'text') {
    textParts.push(value.content)
-   if (toolCalls.length === 0) {
-     yield { type: 'text', content: value.content }
-   }
  }
```

循环结束后，无 tool_calls 时把 `textParts` 逐 chunk yield 出去。

**代价**：最终回复延迟增加约 0.5-2 秒（Agent 场景下回复通常简短，长回复走纯聊天路径不受影响）。工具调用本身的等待期会"吸收"这部分延迟，用户体感差异小。

**改动量**：删 3 行，在 `toolCalls.length === 0` 分支加一个 for 循环。

#### 方案 B：tee() 分流（完美，但复杂）

**思路**：在 Provider 层 fork 出两个流——一个直通前端（低延迟），一个用于 tool_call 检测。检测到 tool_calls 时 cancel 直通分支，前端收到 `round_start` 清空。

**代价**：需要改 Provider 层，引入 `ReadableStream.tee()` 或手动实现双消费者模式，复杂度高。

**改动量**：大，涉及 Provider 接口变更 + Runner 适配。

#### 当前决策（2026-08-16 更新：已实现方案 A）

**方案 A 已落地**。用户确认文本闪烁仍会复现后，采用方案 A 修复：

- [runner.ts](../../server/service/agent/runner.ts) 读流时全缓冲文本（`textParts`），中间轮不再即时 yield 任何 `text` 事件
- 内容审核降级提示由 `contentWarning` 改为 `pendingWarning`，跨轮累积，最终轮统一作为回复前缀发出
- `text` 事件严格只在最终轮出现 → [index.post.ts](../../server/api/chat/index.post.ts) 的「首个 text 才创建 `finalMsgId`」因此天然正确，API 层与前端零改动

**代价**：最终轮回复读完整个响应才发出 → 首字延迟 = 整个回复的生成时间，体感从「打字机流式」退化为「一次性返回」。

#### 方案 A 的副作用：一次性返回（已用前瞻窗口解决）

方案 A 修复了闪烁，但把最终回复也全缓冲了，失去流式体验。2026-08-16 进一步优化为**前瞻窗口**：

- [runner.ts](../../server/service/agent/runner.ts) 读流时缓冲前 `LOOKAHEAD_CHARS` 字符（当前 40，可调），确认无 tool_calls 后才开始流式
- 中间轮：引导文本被缓冲住，读到 tool_calls 时整体丢弃，不闪烁
- 最终轮：窗口满即冲刷，恢复打字机流式（首字延迟 ≈ 窗口字符的生成时间，约 1 秒）

**残留**：闪烁概率趋零但不为零——仅当模型「先输出超过窗口长度的引导文本、之后才调工具」时才会闪烁（比原乐观流式的「任何引导文本都闪烁」罕见得多）。若要彻底消除，见下方「保留引导文本」方向。

- **保留引导文本（备选，未采用）**：中间轮引导文本不再丢弃，随工具卡片一起渲染。100% 流式 + 100% 无闪烁，但需改 Runner / index.post / useChat / buildRenderItems 多处，前端状态管理复杂。

---

## 二、工具调用结果未持久化到 DB（详析 + 方案）

> 优先级最高（数据丢失）。原为「简要记录 2.1」，2026-08-16 补充完整方案并进入实现。

### 问题（现象）

Agent 运行期间，中间轮的 `assistant(tool_calls)` 和 `tool(result)` 消息仅存在于 `AgentMemory` 中。用户刷新页面后，工具调用历史全部丢失，只能看到最终文本回复。**100% 可复现**。

### 原因分析

两个独立缺口，前后端各缺一半：

**后端（未落库）**：[api/chat/index.post.ts](../../server/api/chat/index.post.ts) 的 Agent 分支里：

- `tool_start` / `tool_end` 只发 SSE，**没有任何 DB 写入**
- `text` 只 `updateMessage(newMsg.id, ...)` 更新最终文本
- 中间轮的 `assistant(tool_calls)` 和 `tool(result)` 只在 `AgentMemory` 里活一轮，结束即丢

而 DB 能力早已就绪——`messages` 表的 `tool_calls`（jsonb）和 `tool_call_id`（varchar）字段都在，[addMessages](../../server/service/conversation/mutations.ts) 也支持，只是 Agent 分支没调用。

**前端（渲染不了）**：

- 实时渲染依赖 Pinia 内存态 `agentToolCalls`（SSE 事件驱动），刷新即空
- 历史加载后 [MessageBody.vue](../../app/components/chat/MessageBody.vue) 里 `role='tool'` 既不匹配 `assistant` 分支也不匹配 `user` 分支 → 渲染成空 bot 气泡
- `msg.toolCalls` 字段前端**完全没消费**

### 存储设计

复用现有 `messages` 表，不新建表、不改 schema。一次工具调用落库为**两行消息**，靠 `tool_call_id` 关联：

```
行  role          content        tool_calls                                tool_call_id
─────────────────────────────────────────────────────────────────────────────────────────────
1   assistant     ""             [{"id":"call_1","name":"calculator",       null
                                   "arguments":"{\"expr\":\"235*17\"}"}]
2   tool          "3995"         null                                       "call_1"
3   assistant     "235×17=3995"  null                                       null
```

- **工具名称 + 参数** → 第 1 行（assistant）的 `tool_calls` jsonb，`ToolCall` 结构 = `{ id, name, arguments }`
- **工具结果** → 第 2 行（tool）的 `content`（`text` 无长度限制，`web_search` 摘要也能装）
- **关联关系** → 第 2 行 `tool_call_id` 指回第 1 行 `tool_calls[].id`

**关键规则**：名称和结果**各存一份，不冗余**，靠 `tool_call_id` 反查。失败状态不单独存 `success` 列——错误信息已体现在 tool 行的 `content` 文本里。

### 后端方案

#### ① 扩展 `insertMessage` 支持工具字段

`insertMessage` 目前只接受 `{ role, content }`，需对齐 `addMessages`：

```ts
export async function insertMessage(
  conversationId: string,
  data: {
    role: string
    content: string
    toolCalls?: Message['toolCalls']
    toolCallId?: string
  }
): Promise<MessageDetail> {
  // values 里补 toolCalls: data.toolCalls ?? null, toolCallId: data.toolCallId ?? null
}
```

注意 `?? null` 而非 `?? undefined`——Drizzle 里 `undefined` 是「跳过该列」。

#### ② Agent 分支中间轮落库 + 最终回复延后占位

**核心难点**：当前 `newMsg` 在流**开始**就 `insertMessage` 占位，若直接插入中间轮消息，它们的 `created_at` 会晚于 `newMsg`，导致最终回复排在工具调用**前面**，时间线错乱。

**解法**：Agent 路径的最终回复占位**延后到第一个 `text` 事件**才插入；中间轮消息用 `pendingToolCalls` 累积器在事件循环中串行落库：

```ts
let finalMsgId: string | null = null
let pendingToolCalls: ToolCall[] = []

for await (const event of eventStream) {
  switch (event.type) {
    case 'round_start':
      pendingToolCalls = []                                   // 新一轮重置
      break
    case 'tool_start':
      pendingToolCalls.push({ id: event.toolCallId, name: event.toolName, arguments: event.arguments })
      break
    case 'tool_end':
      if (pendingToolCalls.length > 0) {                      // 本轮第一条 tool_end → 先落 assistant
        await insertMessage(conv.id, { role: 'assistant', content: '', toolCalls: pendingToolCalls })
        pendingToolCalls = []
      }
      await insertMessage(conv.id, { role: 'tool', content: event.result, toolCallId: event.toolCallId })
      break
    case 'text':
      if (!finalMsgId) {                                       // 最终回复延后占位
        finalMsgId = (await insertMessage(conv.id, { role: 'assistant', content: '' })).id
      }
      // ... 原增量 update 改用 finalMsgId
      break
  }
}
```

**为什么可行**：Runner 是「先发完所有 `tool_start`，再执行，再发 `tool_end`」（[runner.ts](../../server/service/agent/runner.ts)），所以**第一个 `tool_end` 到达时 `pendingToolCalls` 已收齐**。串行 `await` 保证 `assistant` 先于 `tool` 插入，`getHistory` 按 `created_at asc` 排序时顺序正确。

**兼容性**：Agent 全程不调工具（第一轮直接回答）时，无 `round_start`/`tool_end`，`finalMsgId` 在第一个 text 才创建，自然兼容。纯聊天路径（无工具注册）**完全不动**，保持现有提前占位。

#### ③ `regenerate` 整组删除

[deleteLastAssistantMessage](../../server/service/conversation/mutations.ts) 目前只删**最后一条**，但 Agent 一次回复现在是多行。需改为「删除最后一个 `role='user'` 之后的所有消息」。

### 前端方案

**核心原则**：渲染层基于 `messages`（含 `toolCalls` / `role='tool'`），而非内存 `agentToolCalls`。分两阶段：

**阶段 1（本次）**：历史消息的工具调用渲染。

1. 新增派生视图 `buildRenderItems(messages)`，把「`assistant(tool_calls)` + 紧随的 `tool`」折叠成一个 `tool_round` 渲染单元，孤立的 `role='tool'` 跳过
2. [AgentToolInline.vue](../../app/components/agent/AgentToolInline.vue) 从「读 store」改为「接受 props」，历史工具以 `status: 'done'` 复用
3. [ChatPanel.vue](../../app/components/chat/ChatPanel.vue) 分流：`isStreaming` 走现有实时逻辑，非流式走 `buildRenderItems`

**阶段 2（可选，延后）**：把 SSE 的 `TOOL_START`/`TOOL_END` 实时物化进 `messages`，移除 `agentToolCalls` 双轨，流式与历史统一渲染。涉及 `useChat`/`chatStore`/`restoreStreamSession`，风险高，阶段 1 稳定后再评估。

> ✅ **2026-08-16 已用轻量方案落地**（非彻底移除双轨，见下文「流式双轨收口修复」）。

**「移除 vs 折叠」的区分**：数据层（后端返回）**三条全保留**——tool 消息要用于重建 LLM 上下文（`assistant(tool_calls)` 和 `tool` 必须成对喂回）和渲染工具卡片的「输出」；展示层（前端渲染）**折叠合并**，非最终消息合并进工具卡片，而不是丢弃。

### 分步实施

```
第一波（后端，数据正确性）：① insertMessage 扩展 → ② Agent 分支落库 → ③ regenerate 整组删除
第二波（前端，历史可见）：    buildRenderItems + AgentToolInline props 化 + ChatPanel 分流
第三波（可选，统一模型）：    移除 agentToolCalls 双轨
```

前后两波解耦：后端做完前端无感（最多刷新后看到空气泡），每步独立回归、独立回滚。

---

### 流式双轨收口修复（2026-08-16 落地）

> 对应上面「前端方案」的**阶段 2**。放弃「彻底移除 `agentToolCalls` 双轨」的大改，改在**流结束这一个收口点**把双轨数据合流，用最小改动解决同一个 bug。

#### 问题（现象）

对话里某条历史回复带工具调用时，**再次发送消息后，这条回复的工具卡片消失**；刷新页面后卡片又回来了。数据其实都在 DB 里。

#### 根因

工具卡片有两条渲染路径，流式路径的数据从未落到 `messages`：

| 场景 | 数据源 | 卡片是否显示 |
|------|--------|:---:|
| 刷新后加载历史 | `messages`（DB 的 `tool_calls`/`tool` 行）→ `buildRenderItems` 折叠 | ✅ |
| 流式进行中 | `agentToolCalls`（内存态，`renderItemTools` 靠 `isStreaming` 门控注入） | ✅ |
| 流结束 / 再次发送 | `isStreaming=false` + `agentToolCalls` 被 `startStreaming` 清空 → 无数据源 | ❌ |

[ChatPanel.vue](../../app/components/chat/ChatPanel.vue) 的 `renderItemTools` 只在 `isStreaming` 时才用 `agentToolCalls` 兜底最后一条 assistant；一旦 `finishStreaming()` 把 `isStreaming` 置 `false`，这条 assistant 在 `messages` 里只是纯文本占位（没有 `toolCalls`/`tool` 行），`item.tools` 为 `undefined`，卡片消失。再次发送时 `startStreaming()` 又清空 `agentToolCalls`，数据彻底丢失，直到刷新从 DB 重新折叠才回来。

#### 修复方案

[chat.store.ts](../../app/stores/chat.store.ts) 新增 `persistAgentToolCalls()`，在 `finishStreaming()` 里把流式期间累积的 `agentToolCalls` 折叠成 `assistant(tool_calls)` + `tool(result)` 行，插入到最后一条 `assistant(text)` 之前：

- 折叠结构与后端落库**完全一致**，`buildRenderItems` 无需任何特判即可还原卡片
- 卡片在流结束后保留，再次发送也不消失（数据已进 `messages`）
- 刷新加载走的还是同一套折叠逻辑，行为统一

#### 为什么是轻量版（不彻底移除双轨）

阶段 2 原文案是「实时物化进 `messages` + 移除 `agentToolCalls`」，要动 `useChat` 的 TOOL_START/TOOL_END 分发、`chatStore` 的实时状态、`restoreStreamSession` 的后台恢复。本次只在「流结束」这一收口点合流，保留了 `agentToolCalls` 作为流式实时态（`running`/`done`/`durationMs`），改动集中在 store 一个函数，风险低、可独立回滚。

#### 已知残留差异

- **耗时（`durationMs`）不持久化**：耗时是前端在 `TOOL_START` 打时间戳、`TOOL_END` 计算的实时态字段，落回 `messages` 后不保留（与历史加载一致），流结束后卡片上的耗时数字会消失，只剩卡片本身。若要持久化需改 schema 或另存字段，作为后续可选优化。
- **后台流中途切回**：`restoreStreamSession` 切回活跃流时，若最后一条 DB 消息是 `tool` 行（工具执行中），后续 `appendStreamContent` 因 `lastMsg.role !== 'assistant'` 不会把最终文本写进 `messages`。这是「切换 + 工具执行中」的极端组合，非本次 bug 范畴，留待完整双轨统一（阶段 2 完整版）时一并处理。

---

## 三、其他已知问题（简要记录）

### 3.1 AbortSignal 未传到工具执行层

**现象**：用户点击停止后，Runner 的 `isAborted()` 检查会在工具执行完毕后阻断下一轮 LLM 调用，但正在执行中的工具（如 `web_fetch` 的 10s 超时 fetch）不会立即中止，会继续跑完。

**修复方向**：`ExecutableTool.execute()` 增加可选 `signal?: AbortSignal` 参数，Runner 传入 `timeoutController.signal`。

### 3.2 Tool usage prompt 需要调优

**现象**：DeepSeek v4-pro 在某些情况下对"你好"等简单问候也调用 `web_search`。当前的工具调用准则（[api/chat/index.post.ts:124-130](../../server/api/chat/index.post.ts#L124-L130)）比较基础，缺少 few-shot 示例。

**修复方向**：在 guidelines 中增加正例/反例，或在工具描述中收紧触发条件。

### 3.3 AgentMemory 裁剪边界缺乏显式约束

**现象**：[memory.ts:39-51](../../server/service/agent/memory.ts#L39-L51) 的 trim 逻辑处理了"cutIndex 指向孤儿 tool 消息"的情况，但没有显式表达"assistant(tool_calls) 和其 tool result 必须成对保留"的约束。当前逻辑下不会出问题，但代码可读性和防御性不足。

**修复方向**：加注释或向前 look-ahead，确保 assistant(tool_calls) 对应的 tool 结果也在保留范围内。

---

## 关键洞察

- **文本闪烁本质是"流式传输的时序不确定"与"乐观流式策略"之间的矛盾**，不是 LLM 行为异常
- **优先级排序**：工具结果持久化（数据丢失，已进入实现） > AbortSignal 传递（健壮性） > Prompt 调优（模型行为） > 文本闪烁（已用方案 A 修复，遗留一次性返回待优化） > Memory 裁剪约束（代码质量）
- 工具结果持久化是唯一「数据丢失」级别的问题，其余都属于体验和健壮性层面的优化（不影响核心 ReAct 循环正确性）

## 相关文档

- [Agent ReAct 完整流程分析](2026-08-05-agent-react-full-flow.md) — 6 层架构数据流追踪
- [Agent 工具系统实现详解](2026-07-29-agent-tool-system-implementation.md) — 实现细节与常见疑点
- [Phase 2 Agent 系统设计方案](../../.claude/plan/phase2-agent-design.md) — 整体架构决策
- [ADR-014：Agent 流式 DB 写入策略](../decisions/014-agent-streaming-db-write.md) — 工具消息 DB 存储格式
