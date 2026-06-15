# 2026-06-08 — 前端开发方案：现状审计、学习策略与实施计划

> 核心洞察：前端从零开始时，最大的敌人不是代码量，而是"不知道从哪里开始"。从数据往界面推——先理解 SSE 事件流和 API 契约，再设计 Store/Composable，最后写 UI 组件——每一步都能验证、都能看到效果。

---

## 讨论背景

Phase 1 后端（Provider 层、SSE 工具、/api/chat、对话 CRUD、数据库 Schema）已基本完成，但前端仍只有一行 `<div>chat ui</div>` 占位符。需要对项目现状做全面审计，明确是否能开始前端开发，并设计一套兼顾学习收益与功能产出的开发方案。

---

## 一、项目现状审计

### 后端已就绪的 API

| API | 方法 | 用途 |
|-----|------|------|
| `/api/chat` | POST (SSE) | 多模型流式对话，返回 meta → text → done/error 事件流 |
| `/api/conversations` | GET | 对话列表（含消息计数、最后一条预览） |
| `/api/conversations` | POST | 创建新对话（title?, model, provider） |
| `/api/conversations/[id]` | GET | 对话详情 + 完整消息历史 |
| `/api/conversations/[id]` | DELETE | 删除对话 + 级联删除消息 |

### 前端现状

| 层级 | 状态 |
|------|------|
| `app/components/` | 不存在 |
| `app/composables/` | 不存在 |
| `app/stores/` | 不存在 |
| `app/pages/index.vue` | 仅占位文本 |
| `app/app.vue` | 仅 SEO 元数据配置 |

### 共享类型（`shared/types/`）

前后端已通过 `provider.ts`（Message, ToolDefinition, ChatOptions）和 `conversation.ts`（ConversationListItem, ConversationDetail, ConversationInput）建立了类型契约，前端可直接引用。

### 结论：✅ 完全可以开始前端开发

后端 API 契约已稳定，工程基础（Nuxt 4 + Nuxt UI v4 + Tailwind CSS v4）已就绪，前端从零开始反而是最佳学习时机。

---

## 二、学习收益最大化策略

核心目标是从"前端开发"转型"AI Agent 开发"，前端开发不是简单的"画界面"，而是建立全栈心智模型。

### 2.1 技术学习价值矩阵

| 维度 | 具体内容 | 学习价值 |
|------|---------|:---:|
| **SSE 全链路理解** | `server/utils/sse.ts` → `api/chat` → `useChat` → UI 组件 | ⭐⭐⭐⭐⭐ |
| **Nuxt 4 全栈模式** | 前后端同构、自动导入、文件系统路由 | ⭐⭐⭐⭐⭐ |
| **Nuxt UI v4** | Chat 组件套件、Color Mode、语义化 Token | ⭐⭐⭐⭐ |
| **SSE 客户端处理** | ReadableStream 消费、心跳重连、断点续传 | ⭐⭐⭐⭐⭐ |
| **类型共享模式** | `shared/types/` → 前后端类型安全 | ⭐⭐⭐⭐ |
| **Service → API → Store → UI** | 四层数据流动 | ⭐⭐⭐⭐ |
| **Pinia 状态管理** | Store 模式、跨组件共享 | ⭐⭐⭐ |
| **Tailwind CSS v4** | CSS 驱动配置、@theme 指令 | ⭐⭐ |

### 2.2 核心原则

> **"从数据往界面推"**（项目核心开发思维）—— 先理解数据流，再设计状态管理，最后写 UI 组件。每一步都能验证、都能看到效果。

具体到前端开发：
1. **先看懂后端 SSE 事件流**：`meta` → `text`（逐 token）→ `done`/`error`，中间夹杂 `ping` 心跳
2. **再设计 Store 和 Composable**：哪些状态跨组件共享，哪些是局部的
3. **最后写 UI 组件**：此时数据层已可独立验证（console.log 就能看到流式数据）

### 2.3 SSE 消费端——最大学习难点

后端 SSE 事件流格式：

```
data: {"type":"meta","conversationId":"xxx"}\n\n
data: {"type":"text","content":"你好"}\n\n
data: {"type":"text","content":"，我"}\n\n
event: ping\ndata: {}\n\n
data: {"type":"done","conversationId":"xxx"}\n\n
```

前端 `useChat` 需要：
1. `fetch()` POST 获取 `response.body`（ReadableStream）
2. `response.body.getReader()` 逐块读取
3. 手动解析 SSE 帧（按 `\n\n` 分割，提取 `data:` 行，JSON.parse）
4. 按 `type` 字段分发处理
5. 支持 AbortController 中断 + 断线自动重连（指数退避）

这是一次彻底理解"LLM 流式输出在浏览器端如何渲染"的机会。

---

## 三、三阶段渐进式实施方案

### 阶段 0：暗黑模式（热身，~0.5 天）

Roadmap 1.7 任务，难度最低但收益立即可见。

**产出文件：**
- `app/composables/useTheme.ts` — 封装 `useColorMode()` + localStorage 持久化
- 修改 `app/app.vue` / `app/pages/index.vue` — 添加模式切换按钮

**学习点：** Nuxt UI v4 的 Color Mode 机制、Composable 模式、Nuxt 自动导入

**验收：** 点击按钮切换主题，刷新后保持偏好

---

### 阶段 1：核心 Chat UI（~2 天）

Roadmap 1.5 任务，应用的核心。

#### 1.1 数据层

**`app/stores/chat.store.ts`**：
```ts
interface ChatState {
  conversations: ConversationListItem[]
  currentId: string | null
  messages: Message[]
  isStreaming: boolean
  selectedProvider: string
  selectedModel: string
}
```

**`app/stores/settings.store.ts`**：全局设置（主题偏好、默认模型等）

#### 1.2 SSE 消费层

**`app/composables/useChat.ts`**：核心 composable，封装 SSE 连接的全部逻辑。

学习价值最高的单一文件——从 ReadableStream 消费、SSE 帧解析、到 AbortController 中断，覆盖浏览器流式处理的全链路。

#### 1.3 UI 层

```
app/components/
├── chat/
│   ├── ChatPanel.vue        # 主面板：消息列表 + 输入框
│   ├── ChatMessage.vue      # 单条消息（区分 user/assistant 角色）
│   ├── ChatInput.vue        # 输入框 + 发送按钮 + 中断按钮
│   └── ModelSelector.vue    # Provider + Model 选择器
└── layout/
    ├── AppSidebar.vue       # 侧边栏：对话列表 + 新建按钮
    └── AppHeader.vue        # 顶部栏：标题 + 暗黑模式切换
```

**关于 Nuxt UI v4 Chat 组件**：建议先手写核心逻辑，理解底层机制（消息滚动、流式文本追加、自动滚底），后续 Agent UI（工具调用可视化、推理过程展示）需要大量自定义组件，手写基础能积累经验。Nuxt UI v4 的 Chat 组件套件可在熟悉机制后选择性引入。

**验收：** 输入消息 → 流式输出逐字显示 → 多模型切换正常 → 不同 Provider 都能对话

---

### 阶段 2：对话管理完善（~1 天）

Roadmap 1.6 的前端部分（后端 CRUD 已完成）。

**功能：**
- 对话列表侧边栏（`ConversationList.vue`）
- 新建对话 → `POST /api/conversations`
- 切换对话 → `GET /api/conversations/[id]` 加载历史
- 删除对话 → `DELETE /api/conversations/[id]`
- 对话标题自动生成（从首条消息截取）

**验收：** 新建 → 列表出现 → 切换加载历史 → 删除消失 → 刷新数据仍在

---

## 四、开发顺序（按文件）

```
第1步:  app/composables/useTheme.ts       ← 热身：最简单的 composable
第2步:  app/stores/settings.store.ts      ← 全局设置状态
第3步:  app/stores/chat.store.ts          ← 核心聊天状态
第4步:  app/composables/useChat.ts        ← 核心：SSE 消费逻辑
第5步:  app/components/layout/AppHeader.vue     ← 顶部栏
第6步:  app/components/chat/ModelSelector.vue   ← 模型选择
第7步:  app/components/chat/ChatMessage.vue     ← 单条消息
第8步:  app/components/chat/ChatInput.vue       ← 输入框
第9步:  app/components/chat/ChatPanel.vue       ← 主面板（组合 6+7+8）
第10步: app/components/layout/AppSidebar.vue    ← 侧边栏
第11步: app/pages/index.vue                     ← 组合一切
```

每一步完成后 `npx nuxi dev` 都能看到效果，渐进式验证。

---

## 五、关键设计决策

### 5.1 状态管理粒度

| 状态 | 存放位置 | 原因 |
|------|---------|------|
| 当前对话消息 | `chatStore` | ChatPanel、ChatInput、ConversationList 都需要 |
| 对话列表 | `chatStore` | 侧边栏和主面板共享 |
| SSE 连接/流式状态 | `useChat` 内部 | 只跟 sendMessage 相关，不需要全局 |
| 暗黑模式 | `settingsStore` | 全局，后续会有更多设置项 |
| 模型/Provider 选择 | `chatStore` | 后续 Agent/Skills 可能覆盖默认值 |

### 5.2 手写 vs 使用 Nuxt UI v4 Chat 组件

决策：**核心逻辑手写，UI 加速可用组件库。**

- `useChat` composable（SSE 消费、状态管理）—— 必须手写，这是最大学习点
- 消息展示组件 —— 先手写理解机制，后续可替换为 Nuxt UI v4 的 `ChatMessages`/`ChatMessage`
- 通用 UI（按钮、下拉、侧边栏）—— 用 Nuxt UI v4 的 `UButton`、`USelect`、`USlideover` 等

### 5.3 SSE 重连策略

Cloudflare 有 100s 空闲超时，但对话场景下 SSE 流持续有数据，不会触发。重连主要应对网络抖动：
- 检测到连接中断 → 指数退避重连（1s → 2s → 4s → 最大 30s）
- 重连时携带 `Last-Event-ID` 实现断点续传（如后端支持）

---

## 相关文档

- [架构设计](.claude/plan/architecture.md) — 前端组件树、Composable、Store 规划
- [实施路线图](.claude/plan/roadmap.md) — Phase 1 任务状态
- [前端规则](.claude/rules/frontend.md) — Nuxt UI v4 组件使用规范、路径别名
- [SSE 规则](.claude/rules/sse.md) — 心跳机制、客户端重连要求
- [SSE 实现记录](2026-06-03-sse-implementation.md) — 后端 SSE 工具实现细节
- [对话持久化设计](2026-06-03-conversation-persistence-design.md) — 对话 CRUD 的设计决策
- [开发思维转变](2026-05-31-mindset.md) — "从数据往界面推"核心方法论
