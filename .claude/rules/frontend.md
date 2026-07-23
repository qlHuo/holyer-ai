---
paths:
  - "app/**"
description: 前端开发规范 — Nuxt UI v4 组件用法、暗黑模式、路径别名、Tailwind CSS v4、Pinia 状态管理
---

# 前端规则

## 何时应用此规则

- 在 `app/` 下新增或修改 Vue 组件、页面、composable、store 时
- 使用 UI 组件时（确认用的是 Nuxt UI v4 API 而非 v3）
- 处理样式时（确认用 Tailwind CSS v4 的 CSS 驱动配置而非 v3 的 JS 配置）
- 新增状态管理时（确认 Pinia 已注册、使用 Setup Store 语法）
- 处理暗黑模式时（使用 `useColorMode()` 而非手动 class 切换）

## UI 组件库

使用 **Nuxt UI v4**（不是 v3，API 差异大）：

- 导入方式：`@nuxt/ui` 组件自动导入，无需手动 import
- Chat 组件套件：`ChatMessages`, `ChatMessage`, `ChatPrompt`, `ChatReasoning`, `ChatTool`, `ChatShimmer`
- 其它常用组件：`UButton`, `UInput`, `UModal`, `USlideover`, `UDropdownMenu`, `UAvatar`

## 暗黑模式

Nuxt UI v4 内置 color mode：

```ts
const colorMode = useColorMode()  // 'light' | 'dark' | 'system'
colorMode.preference = 'dark'     // 手动切换
```

主题颜色通过 `app.config.ts` 或 `nuxt.config.ts` 中的 `ui.colors` 配置。

## 路径别名

- `~/` → `app/`（Nuxt 4 默认）
- `#shared/` → `shared/`（需在 `tsconfig.json` 中配置）

## 样式

- Tailwind CSS v4 使用 **CSS 驱动配置**（`@theme` 指令在 `app/assets/css/main.css` 中），不需要 `tailwind.config.ts`（v4 已废弃 JS 配置文件）
- Nuxt UI v4 组件使用语义化颜色 token（`bg-(--ui-bg)` 等），不硬编码颜色值

## 状态管理 (Pinia)

**Nuxt 4 不自带 Pinia**，必须显式安装：

```bash
pnpm add pinia @pinia/nuxt
```

然后在 `nuxt.config.ts` 的 `modules` 中注册：

```ts
modules: [
  '@nuxt/eslint',
  '@nuxt/ui',
  '@pinia/nuxt'   // ← 必须手动添加
],
```

安装后运行 `npx nuxi prepare` 生成类型，`defineStore`、`storeToRefs` 等 API 自动导入，无需手动 import。

### Store 文件规范

- 放在 `app/stores/`，Nuxt 自动导入
- 使用 Setup Store 语法（`defineStore('name', () => { ... })`）
- 文件名 `xxx.store.ts`

## VueUse 工具库

项目已注册 `@vueuse/nuxt` 模块，所有 VueUse composable 自动导入，常用：

| Composable | 用途 |
|------------|------|
| `useStorage()` | localStorage 响应式绑定 |
| `useDebounceFn()` | 防抖（搜索输入等） |
| `useEventListener()` | 事件监听（自动清理） |
| `useMediaQuery()` | 响应式媒体查询 |
| `useClipboard()` | 剪贴板操作 |

> 完整列表见 [VueUse 文档](https://vueuse.org/)。无需手动 import，直接用。

## Composable 模式

| Composable | 用途 | 状态 |
|------------|------|:--:|
| `useChat()` | SSE 流式聊天、消息状态管理（V2 架构） | ✅ |
| `useTheme()` | 封装 `useColorMode()` + 持久化偏好 | ✅ |
| `useChat()` 扩展 | `sendAgentMessage()`、`agentToolCalls`、`agentCurrentRound` 等 Agent 状态集成在 `useChat` 中（无需独立 composable） | ⬜ P2 |
