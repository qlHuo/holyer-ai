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

## 表单规范

**硬约束**：表单必须用 Nuxt UI v4 的 `<UForm>` 组件 + Zod Schema 校验，**禁止手写 `<div>` + `<input>` + 手动 validate**。

```vue
<!-- ❌ 错误：手写表单，项目已安装 Nuxt UI v4 和 Zod -->
<div class="flex flex-col gap-2">
  <label>名称</label>
  <input v-model="form.name" class="border rounded p-2" />
  <p v-if="errors.name" class="text-red-500">{{ errors.name }}</p>
</div>

<!-- ✅ 正确：用 Nuxt UI v4 的 UForm + Zod -->
<script setup>
const schema = z.object({
  name: z.string().min(1, '名称不能为空').max(100),
  content: z.string().min(1, '内容不能为空'),
})
const form = reactive({ name: '', content: '' })
</script>
<template>
  <UForm :schema="schema" :state="form" @submit="onSubmit">
    <UFormField label="名称" name="name">
      <UInput v-model="form.name" />
    </UFormField>
    <UFormField label="内容" name="content">
      <UTextarea v-model="form.content" />
    </UFormField>
    <UButton type="submit">提交</UButton>
  </UForm>
</template>
```

> Zod 已在项目 `package.json` 中安装，前端直接用，不需要额外安装。

## Modal / 弹窗规范

Nuxt UI v4 的 `UModal` 自带 `header/body/footer/title/description/close` slots，内容直接放对应 slot，**不要**再内嵌一层 `<UCard>`。

**底部操作区统一靠右**：
- 操作按钮直接平铺在 `<template #footer>`，**不要**用 `<div class="flex justify-end gap-2">` 包一层——footer 主题自带 `flex items-center gap-1.5 p-4 sm:px-6`，间距/内边距由主题托底
- 右对齐用 `:ui` 的 `footer` 键追加：`:ui="{ content: 'sm:max-w-[560px]', footer: 'justify-end' }"`（宽度走 `content` 键）

```vue
<!-- ❌ 手写 wrapper：对齐/间距逻辑散落各文件，且冗余 -->
<template #footer>
  <div class="flex justify-end gap-2">
    <UButton color="neutral" variant="ghost" @click="close">取消</UButton>
    <UButton color="primary" @click="save">保存</UButton>
  </div>
</template>

<!-- ✅ 交给主题：footer 裸按钮 + :ui.footer 右对齐 -->
<UModal :ui="{ content: 'sm:max-w-[560px]', footer: 'justify-end' }">
  <template #body>…</template>
  <template #footer>
    <UButton color="neutral" variant="ghost" @click="close">取消</UButton>
    <UButton color="primary" @click="save">保存</UButton>
  </template>
</UModal>
```

按钮约定：取消 `color="neutral" variant="ghost"`；主操作 `color="primary"`；破坏性操作 `color="error"`。弹窗开关用 `v-model:open` + 受控 props（见现有 prompts/rag modal）。

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
- Nuxt UI v4 组件使用语义化颜色 token，不硬编码颜色值
- **类名用 canonical 形式**（保持 IDE canonical 提示为 0）：
  - `--radius-*` 已在 `@theme` 覆盖（`--radius-lg: 0.75rem`），`rounded-lg` 即等于设计 token 值 → 写 `rounded-lg`，**不要** `rounded-(--radius-lg)`
  - 语义文字色用别名类：`text-dimmed` / `text-highlighted` / `text-default`，**不要** `text-(--ui-text-dimmed)` 这类 var 形式
  - Tailwind v4 折行写 `wrap-break-word`（`break-words` 是废弃别名）

## hover 交互反馈规范

容器类 hover 反馈（卡片、列表行、可点击面板）只用 **背景色 / border 色 / box-shadow** 表达，**不要用 transform 位移**（如 `-translate-y-*`）做 hover 微交互——位移会「推挤」相邻元素观感，也让亮暗/低动效场景不稳定。

```html
<!-- ✅ 正确：hover 用 border / shadow / bg 反馈 -->
<div class="rounded-lg border border-default hover:border-primary hover:shadow-sm transition-colors" />

<!-- ❌ 错误：hover 位移（transform）做反馈 -->
<div class="hover:-translate-y-0.5 hover:shadow-lg" />
```

需要位移的进场动画（如列表交错入场、弹层浮现）走一次性 `@keyframes` 动画，不进 hover 态。

## 截断内容的「看全文」

`line-clamp` 截断的正文不能截断即终点，要给「看全文」入口：

- **长文本（首选）**：`UPopover mode="hover"`（HoverCard 语义，悬停即开，配 `:open-delay` / `:close-delay` 防抖）。**面板高度必须受控**：外层定 `max-h-*`，正文区 `flex-1 overflow-y-auto` 独立滚动；长文本用 `<pre>` + `whitespace-pre-wrap wrap-break-word` 保排版（见 PromptsCard 全文面板）
- **短文本/术语**：才用 `UTooltip` 小气泡——别把几百字塞进 tooltip
- 触发器上放一个 hover 浮现的小图标（如眼睛）暗示可看全文

## 卡片列表一致性

prompts / rag 这类同级列表管理页共享同一卡片范式，改动前先对照同级页，避免一页一风格：

- 卡片 `flex flex-col h-full`，靠 CSS Grid 等高；底部信息行用 `mt-auto` 推底，跨卡对齐
- 操作按钮**常显**（不做 `opacity-0 group-hover` 隐藏），编辑用主题色、删除 `color="error"`、`.stop` 冒泡
- hover 反馈只 border/shadow（见上节）；整卡可点即整卡可点，不要只给标题区做点击

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
