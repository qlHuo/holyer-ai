# 2026-06-18 — Phase 1 全面审查与改造方案

> 核心洞察：Phase 1 代码结构清晰、功能完整，但从"能用"到"好用"存在系统性差距——缺失设计规范、错误反馈体系、API 抽象层、公共方法封装。这些不是个别 bug，而是整个应用层的横切关注点缺失。

---

## 一、问题全貌（五大类、36 项）

审查范围：页面功能（UI/UX） + 前端架构 + 后端架构 + 错误反馈 + 工程化。按改造依赖关系从底向上分为五层：

```
┌─────────────────────────────────────────────┐
│  第五层：体验打磨                             │
│  设计规范 · 动画 · 键盘快捷键 · 欢迎页         │
├─────────────────────────────────────────────┤
│  第四层：功能补全                             │
│  消息操作 · ChatInput重写 · 搜索 · Mermaid    │
├─────────────────────────────────────────────┤
│  第三层：交互兜底                             │
│  错误反馈体系 · SSE 重连 · 粘贴处理 · 空状态   │
├─────────────────────────────────────────────┤
│  第二层：架构重构                             │
│  API层 · Store拆分 · 响应格式统一 · 公共方法  │
├─────────────────────────────────────────────┤
│  第一层：工程基础                             │
│  Zod验证 · 错误中间件 · 日志 · 清理死代码      │
└─────────────────────────────────────────────┘
```

---

## 二、第一层：工程基础（P0 — 不改则后续开发持续受阻）

### 2.1 后端缺少参数验证

**现状**：所有 API 端点都是手动 `if (!xx) throw createError(...)` 校验。

```ts
// 当前：类型不安全的校验
const body = await readBody(event)  // → unknown
const { provider, model, message } = body  // 直接解构，无类型保护
if (!provider || !model || !message?.length) {
  throw createError({ status: 400, message: '缺少必要参数' })
}
```

**改造**：引入 `zod`，在 Service 入口处做一次校验：

```ts
const ChatBodySchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'deepseek']),
  model: z.string().min(1),
  message: z.array(MessageSchema).min(1),
  conversationId: z.string().uuid().optional()
})

// handler 中
const body = ChatBodySchema.parse(await readBody(event))
// body 现在有完整类型，非法参数自动抛 400
```

影响文件：`server/api/chat/index.post.ts`、`server/api/conversations/*.ts`（4 个端点）

### 2.2 后端缺少全局错误处理中间件

**现状**：Service 层抛出的未预期错误直接穿透到 Nitro，返回 HTML 错误页而非 JSON。

**改造**：添加 `server/middleware/error-handler.ts`，统一捕获所有异常并返回 JSON。

### 2.3 前端/后端公共方法未封装

**后端重复代码**：

| 重复逻辑 | 出现位置 | 抽取目标 |
|----------|----------|----------|
| `extractSystemPrompt` | openai.ts / anthropic.ts / deepseek.ts | `server/utils/system-prompt.ts` |
| 参数校验 + 错误响应 | 4 个 API 端点 | `server/utils/response.ts` |

**前端重复/散落代码**：

| 函数 | 当前位置 | 抽取目标 |
|------|----------|----------|
| `formatTime` | LayoutSidebar 内联 | `app/utils/format.ts` |
| `extractSSEField` | useChat 内联 | `app/utils/sse.ts` |
| `copyToClipboard` | MarkdownContent 内联 | `app/utils/clipboard.ts` |
| SSE 事件类型字符串 | useChat / chatStore / sse.ts | `shared/types/sse.ts` 枚举化 |

### 2.4 死代码清理

| 文件 | 问题 | 动作 |
|------|------|------|
| `app/stores/settings.store.ts` | 与 chatStore 功能重叠，无任何引用 | 删除 |
| `server/api/test.get.ts` | 开发期测试端点遗留 | 删除 |
| `package.json#name` | `"ai-temp"` 占位名 | 改为 `"holyer-ai"` |
| `app/app.vue` 描述文本 | 写 "Nuxt3" 实为 Nuxt 4 | 修正 |

---

## 三、第二层：架构重构（P0 — 决定后续开发效率和质量天花板）

### 3.1 前端缺少 API 抽象层

**现状**：`$fetch` 调用散落在 store actions 和 composable 中，URL 硬编码、类型重复声明。

**改造**：创建 `app/api/` 目录，每个资源一个文件：

```
app/api/
├── index.ts            ← $fetch 实例（baseURL、统一错误拦截、超时配置）
├── conversations.ts    ← getList / getDetail / create / remove
└── chat.ts             ← sendMessage (SSE，返回 ReadableStream)
```

改造前：
```ts
// chat.store.ts — 类型手动标注，URL 散落
const data = await $fetch<ConversationListItem[]>('/api/conversations')
```

改造后：
```ts
// chat.store.ts
import { conversationApi } from '~/api/conversations'
const data = await conversationApi.getList()  // 类型自动推断
```

### 3.2 后端响应格式不统一

**现状**：5 个接口 4 种返回格式：

| 接口 | 成功 | 失败 |
|------|------|------|
| GET 列表 | `Array` | Nitro 默认 HTML |
| GET 详情 | `Object` | `{ statusCode, message }` |
| POST 创建 | `Object` | `{ statusCode, message }` |
| DELETE | `{ success: true }` | `{ statusCode, message }` |
| POST chat | SSE 流 | SSE `{ type: 'error' }` |

**改造**：统一为 `{ success, data, error }` 包装结构。

> 这个决策涉及前后端契约变更，提取为独立 ADR（见下方 ADR-011）。

### 3.3 chatStore 职责过重需拆分

**现状**：一个 Store 包含对话 CRUD、消息管理、流式状态、模型选择、API 调用——200+ 行，5 类职责混在一起。

**改造**：

```
stores/
├── conversation.store.ts   ← 对话列表 + CRUD + currentId（~70行）
├── message.store.ts        ← 消息列表 + 流式状态（~50行）
└── settings.store.ts       ← Provider/Model/Theme 偏好（~40行，替换旧版）
```

拆分原则：
- 跨组件共享 → Store
- 单组件局部 → Composable 内部状态
- API 调用逻辑 → 移入 `app/api/`

### 3.4 后端 Provider 工厂可扩展性不足

**现状**：硬编码 `switch-case`，新增 Provider 必须修改工厂源码。

**改造**：注册表模式，Provider 自注册，工厂只负责查找和配置注入。新增 Provider 只需添加一个文件。

### 3.5 前端 Provider/Model 数据双写

**现状**：`app/constants/providers.ts` 与后端各 Provider 的 `models()` 返回数据重复维护。后端已有一套完整的模型列表，前端又硬编码了一份。新增模型需要改两处。

**改造**：后端新增 `/api/models` 接口，前端从接口动态获取，`providers.ts` 仅作为离线 fallback。

---

## 四、第三层：交互兜底（P0 — 用户能感知的核心体验缺口）

### 4.1 错误反馈体系完全缺失

这是当前最严重的体验问题。**所有失败操作对用户完全静默。**

| 场景 | 用户操作 | 当前实际 | 应有反馈 |
|------|----------|----------|----------|
| 网络断开 | 点击发送 | 按钮转圈后无反应 | 顶部红色横幅"网络连接失败" |
| API Key 无效 | 发送消息 | 消息气泡消失 | Toast "认证失败，请检查 API Key" |
| 对话列表加载失败 | 打开侧边栏 | 一直显示空状态 | 空状态 + "加载失败，点击重试"按钮 |
| 删除对话失败 | 点击删除 | 弹窗关闭但对话还在 | Toast "删除失败，请重试" |
| SSE 流中断 | 接收回复中 | 光标停闪，消息不完整 | 消息末尾"生成中断，点击继续" |
| 请求超时 | 任何操作 | 永久等待 | Toast "请求超时，请重试" |

**改造方案**：

```
错误反馈体系
├── Toast 通知系统       ← 操作结果即时反馈（useToast 已有，只需补齐调用）
├── 内联消息错误态       ← 发送失败的消息气泡变红 + 重试按钮
├── 全局状态横幅         ← 网络断开/服务异常时顶部红色横幅（可关闭）
├── 空状态错误变体       ← 加载失败时显示"重试"而非"暂无数据"
└── SSE 错误恢复态       ← 流中断时消息末尾显示提示 + 继续生成按钮
```

**实现要点**：
- `chat.store.ts` 中所有 `catch` 块除了 `console.error` 外，必须调用 `toast.add` 或设置 `error` 状态
- `useChat` composable 中的 `error` ref 必须在 `ChatPanel` 中渲染（目前设置了但 UI 未消费）
- 新增 `app/composables/useNetworkStatus.ts` 监听 `navigator.onLine`
- 新增 `app/components/common/ErrorBanner.vue` 全局横幅组件

### 4.2 SSE 连接中断无自动恢复

**现状**：`useChat.ts` 中 Stream 断开只是 `catch` + `finishStreaming`，消息丢失。

**改造**：指数退避重连（1s → 2s → 4s → max 30s），重连时携带 `Last-Event-ID`，断点续传。这在前端开发方案中已经设计过，只是未实现。

### 4.3 粘贴场景完全未处理

**现状**：粘贴任意内容直接进 `input.value`，富文本、超大文本、图片均无特殊处理。

**改造**：监听 `paste` 事件：
- 纯文本 → 去格式后填入
- 含图片 → 触发上传预览（Phase 2 附件功能的基础）
- 超长文本（>5000 字符）→ 弹出确认或自动切换模式

---

## 五、第四层：功能补全（P1 — 接近竞品基础体验）

### 5.1 ChatInput 用 contenteditable div 重写

**现状**：原生 `<textarea>`，扩展性差，无法支持未来附件/富文本/智能体切换。

**改造**：`contenteditable` div 方案（ChatGPT/DeepSeek/千问/Claude.ai 全部采用）。输入区域分为：

```
┌─────────────────────────────────────┐
│  [附件预览区]                         │  ← Phase 2
│  [contenteditable 输入区]             │
│  [工具栏: 模型选择 | 附件 | 发送/停止]  │
└─────────────────────────────────────┘
```

Phase 1 只需支持纯文本输入 + 发送 + 模型切换，但要为后续扩展预留结构。

### 5.2 消息操作按钮

**现状**：消息只有展示，无任何交互操作。

**改造**：每条消息 hover 时显示操作按钮：

| 操作 | 用户消息 | 助手消息 |
|------|:--:|:--:|
| 复制纯文本 | ✅ | ✅ |
| 复制 Markdown 原文 | — | ✅ |
| 重新生成回答 | — | ✅ |
| 编辑后重新发送 | ✅ | — |

实现为 `<MessageActions>` 组件，hover 时在消息气泡旁浮动出现。

### 5.3 代码高亮主题缺失

**现状**：`markdown.ts` 使用 `hljs.highlight()` 生成了带 class 的 HTML，但 `main.css` 从未引入 highlight.js 的 CSS 主题文件，代码块实际无颜色。

**改造**：在 `main.css` 中引入 `highlight.js/styles/github.css` 和 `highlight.js/styles/github-dark.css`（通过媒体查询适配亮暗模式），或使用 `highlight.js/styles/github-dark-dimmed.css` 等更精致的主题。

### 5.4 侧边栏功能补全

| 功能 | 现状 | 改造 |
|------|------|------|
| 搜索对话 | 无 | 顶部添加搜索输入框，按标题模糊匹配 |
| 折叠侧边栏 | 无 | 添加折叠按钮，收起后只显示图标 |
| Loading 态 | spinner 不覆盖列表 | 首次加载用骨架屏，刷新用顶部轻量指示器 |
| 防重复创建 | 无限制 | 当前为空对话时阻止新建，切到该对话 |

### 5.5 Mermaid 流程图渲染

**现状**：` ```mermaid ` 当普通代码块显示。

**改造**：在 `markdown.ts` 自定义 fence renderer 中识别 `mermaid` 语言，生成 `<div class="mermaid">`，在 `MarkdownContent.vue` 的 `onMounted` 中调用 `mermaid.run()`。

---

## 六、第五层：体验打磨（P1/P2 — 从"能用"到"精致"）

### 6.1 设计规范体系

**现状**：仅 `primary: 'green'`，其余全用 Nuxt UI 默认。

**改造**：在 `main.css` 中建立完整的设计 Token 体系：

```
设计规范
├── 色彩      ← 品牌色(green) / 语义色(red/amber/blue) / 表面色 / 边框色
├── 字体      ← 标题(系统sans) / 正文(系统sans) / 代码(JetBrains Mono或系统mono)
├── 间距      ← 基于 4px 网格（2/4/6/8/12/16/24/32）
├── 圆角      ← 组件级(0.375rem) / 气泡级(0.5rem) / 面板级(0.75rem)
├── 阴影      ← 悬浮/弹窗/抽屉 三层深度
├── 动效      ← 页面过渡(200ms) / 消息入场(150ms) / 状态切换(100ms ease)
└── 滚动条    ← webkit-scrollbar 定制（6px 宽、圆角、半透明、暗色适配）
```

### 6.2 页面初始化

| 问题 | 改造 |
|------|------|
| 首次加载无骨架屏 | 侧边栏 + 主区域各自用 Skeleton 组件占位 |
| 暗黑模式切换生硬 | 给 `<html>` 加 `transition: color, background-color 200ms` |
| 欢迎页太朴素 | 参考 DeepSeek 风格，展示模型能力和示例 prompt |

### 6.3 键盘快捷键

```
Ctrl+K      → 搜索/切换对话（Command Palette）
Ctrl+N      → 新建对话
Ctrl+Enter  → 发送消息
Esc         → 中断生成 / 关闭弹窗
Ctrl+/      → 显示快捷键帮助面板
```

### 6.4 公共 UI 组件抽取

| 组件 | 复用场景 | 来源 |
|------|----------|------|
| `ConfirmModal` | 删除对话、清空消息等 | 从 LayoutSidebar 抽离 |
| `LoadingSkeleton` | 列表加载、消息加载 | 新建 |
| `EmptyState` | 空对话、空搜索结果 | 整合欢迎页和侧边栏空状态 |
| `ErrorBanner` | 网络断开、服务异常 | 新建 |
| `MessageActions` | 复制、重新生成、编辑（重新生成详见[设计文档](2026-06-22-regenerate-design.md)） | 新建 |

---

## 七、工程化补全（P2）

### 7.1 后端补充

| 项 | 作用 |
|------|------|
| 请求日志中间件 | 输出 `[POST /api/chat] 200 2.3s` |
| API 版本前缀 | `/api/v1/*`（为未来平滑升级预留） |

### 7.2 质量保障

| 项 | 作用 |
|------|------|
| TypeScript `strict: true` | 类型安全性兜底 |
| API 测试（vitest） | 至少覆盖 conversations CRUD |
| 多 Provider 端到端验证 | OpenAI/Anthropic/DeepSeek 全量切换测试 |

### 7.3 文档更新

| 文件 | 动作 |
|------|------|
| `.claude/plan/roadmap.md` | 新增 Phase 1.5（本次审查的改造项），更新 1.5/1.7 状态 |
| `CLAUDE.md` | 追加本次审查文档引用 |

---

## 八、改造顺序建议

按依赖关系，分 3 轮执行：

### 第一轮（1-2 天）：工程基础 + 架构重构

```
1. 死代码清理（settings.store 删除/重写、test.get.ts 删除、app.vue 修正）
2. 后端：zod 验证 + 错误中间件 + system-prompt 公共抽取
3. 后端：API 响应格式统一（包 wrapper）
4. 前端：app/api/ 层创建 + $fetch 封装
5. 前端：Store 拆分（conversation / message / settings）
6. 前端：SSE 事件类型枚举 + 公共工具抽取（formatTime / clipboard / sse）
```

### 第二轮（2-3 天）：交互兜底 + 功能补全

```
7.  错误反馈体系（Toast 补齐 + ErrorBanner + 消息错误态 + 空状态错误变体）
8.  SSE 重连机制
9.  粘贴处理
10. ChatInput div 重写
11. 消息操作按钮（复制/重新生成/编辑）
12. 代码高亮 CSS 主题
13. 侧边栏搜索 + 折叠 + 骨架屏 + 防重复创建
14. 公共组件抽取（ConfirmModal / EmptyState / LoadingSkeleton / MessageActions）
```

### 第三轮（1-2 天）：体验打磨 + 工程化

```
15. 设计规范体系落地（配色/字体/滚动条/动效）
16. 页面初始化优化（骨架屏 + 欢迎页）
17. 键盘快捷键
18. Mermaid 渲染
19. 前端 /api/models 动态获取替代硬编码
20. 后端 + 日志中间件
21. TypeScript strict: true
```

---

## 九、改造前后对比

| 维度 | 改造前 | 改造后 |
|------|--------|--------|
| **错误反馈** | 静默失败 | Toast + 内联错误 + 全局横幅 + 重试 |
| **API 调用** | `$fetch` 散落各处，URL 硬编码 | `app/api/` 统一导出，类型自动推断 |
| **状态管理** | 1 个超大 Store 混 5 类职责 | 3 个 Store 各司其职 |
| **响应格式** | 4 种格式，前端需逐接口适配 | 统一 `{ success, data, error }` |
| **参数校验** | 手动 if/else，类型不安全 | Zod Schema，编译时 + 运行时双保险 |
| **代码复用** | system-prompt 3 处重复，工具函数内联 | 公共 utils 封装 |
| **设计规范** | 无，全依赖 Nuxt UI 默认 | 品牌色 + 间距 + 圆角 + 动效体系 |
| **代码高亮** | 生成 HTML 但无颜色 | highlight.js 主题引入（亮暗双模式） |
| **输入框** | textarea 扩展性差 | contenteditable div 预留附件/Agent 扩展 |
| **侧边栏** | 无搜索/折叠/骨架屏 | 全套交互完善 |

---

## 相关文档

- [前端开发方案](2026-06-08-frontend-dev-plan.md) — Phase 1 前端实施计划
- [对话持久化设计](2026-06-03-conversation-persistence-design.md) — CRUD 设计决策
- [SSE 实现记录](2026-06-03-sse-implementation.md) — 后端 SSE 工具细节
- [Provider 实现记录](2026-06-01-provider-implementation.md) — Provider 三层架构
- [接口性能诊断](2026-06-16-perf-neon-latency.md) — 数据库查询优化
- [架构设计](../../.claude/plan/architecture.md)
- [实施路线图](../../.claude/plan/roadmap.md)

---

## 十、工程基础改造记录（2026-06-20）

> 第一层四项（2.1–2.4）已全部完成改造，进度 100%。

### 完成清单

#### 2.1 Zod 参数校验 ✅

新建两个 Schema 文件，改造 4 个端点：

| 文件 | 说明 |
|------|------|
| `server/api/chat/schema.ts` | `ChatBodySchema` — 包含 `MessageSchema`、工具定义、温度/Token 范围 |
| `server/api/conversations/schema.ts` | `CreateConversationSchema` — title/mode/provider |
| `server/api/chat/index.post.ts` | `ChatBodySchema.parse(await readBody(event))` |
| `server/api/conversations/index.post.ts` | `CreateConversationSchema.parse(await readBody(event))` |
| `server/api/conversations/[id].get.ts` | `z.string().uuid().parse(getRouterParam(event, 'id'))` |
| `server/api/conversations/[id].delete.ts` | 同上 |

**Zod v4 关键踩坑**：

| 坑 | 现象 | 解法 |
|----|------|------|
| `z.string().optional()` | `null` 值报错（前端 `ref<string \| null>` 序列化保留 null） | 用 `.nullish()` 接受 `null \| undefined` |
| `error.errors` | 属性不存在 | v4 改名 `error.issues` |
| `z.record(z.unknown())` | 提示"应有 2-3 个参数" | v4 必须显式传 key：`z.record(z.string(), z.unknown())` |
| `z.object(z.unknown())` | 编译通过但运行时行为错误 | `z.object()` 接收形状描述，不是单个类型；动态键用 `z.record()` |

#### 2.2 全局错误中间件 ✅

创建 `server/plugins/error-handler.ts`，通过 Nitro `error` hook 统一拦截：

- **选型**：`server/plugins/` + `error` hook（不是 `server/middleware/`）。Middleware 无法捕获 handler 抛出的异常，只有 Nitro plugin 的 error hook 可以
- **三层分发**：`ZodError` → 400 + 字段级详情 · `H3Error` → 保持原 statusCode · `unknown` → 500（生产环境隐藏细节）
- **h3 依赖**：必须显式导入 `send`、`isError`、`setResponseStatus`、`setResponseHeader`
- **`isError` vs `isH3Error`**：h3 v1.15.11 只导出 `isError`，不存在 `isH3Error`。`isError` 检查对象是否含 `statusCode` 属性，足以区分 H3Error

#### 2.3 公共抽取 ✅（主体）

**后端**：

| 抽取 | 文件 | 引用方 |
|------|------|--------|
| `extractSystemPrompt` | `server/utils/system-prompt.ts` | openai.ts / anthropic.ts / deepseek.ts |

**SSE 事件类型枚举**：

| 文件 | 说明 |
|------|------|
| `shared/types/sse.ts` | `SSE_EVENT` const 对象（META/TEXT/DONE/ERROR/PING）+ `SSEEventType` 类型 |
| `server/utils/sse.ts` | `SSEChunk.type` 从 `string` → `SSEEventType` |
| `server/api/chat/index.post.ts` | 全部 `'meta'`/`'text'`/`'done'`/`'error'` 替换为 `SSE_EVENT.*` |
| `app/composables/useChat.ts` | `case 'meta':` 替换为 `case SSE_EVENT.META:` 等 |

> 为什么用 `const` 对象而非 TypeScript `enum`：零运行时开销，`switch`/`if` 完全兼容，与 Zod v4 风格一致。

**前端**：

| 抽取 | 文件 | 说明 |
|------|------|------|
| `extractSSEField` | `app/utils/sse.ts` | 从 useChat 抽离，Nuxt 自动导入 |

`formatTime` 和 `copyToClipboard` 各仅被一处使用，消除不了重复，推迟到架构重构轮次。

#### 2.4 死代码清理 ✅

| 项 | 状态 |
|----|:--:|
| `app/stores/settings.store.ts` — 删除 | ✅ |
| `server/api/test.get.ts` — 删除 | ✅ |
| `app/app.vue` — "Nuxt3" → "Nuxt 4" | ✅ |
| `package.json#name` — "ai-temp" → "holyer-ai" | ✅ |

### 遗留问题（已全部修复）

| # | 位置 | 问题 | 状态 |
|---|------|------|:--:|
| ① | `server/utils/sse.ts:67` | catch 分支硬编码 `type: 'error'`，未用 `SSE_EVENT.ERROR` | ✅ 已修复 |
| ② | `server/api/chat/index.post.ts:37` | `createError({ status: 404 })` 应改为 `statusCode: 404` | ✅ 已修复 |

### 相关文档

- [Phase 1 审查报告](2026-06-18-phase1-review.md)
- [实施路线图](../../.claude/plan/roadmap.md)
