---
paths:
  - "app/**"
---

# 前端规则

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

## Composable 模式（待创建）

以下 composable 将在开发中逐步创建：

| Composable | 用途 | 文件位置 |
|------------|------|----------|
| `useChat()` | SSE 连接、消息流、重连逻辑 | `app/composables/useChat.ts` |
| `useAgent()` | Agent 运行时状态、工具调用展示 | `app/composables/useAgent.ts` |
| `useTheme()` | 封装 `useColorMode()` + 持久化偏好 | `app/composables/useTheme.ts` |

所有 composable 放在 `app/composables/`，Nuxt 自动导入。
