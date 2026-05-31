# ADR-002: Nuxt UI v4 组件库

> 日期：2026-05-31 · 状态：✅ 已采纳

---

## 背景

需要为 AI 聊天平台选择 UI 组件库。核心需求：AI Chat 组件（消息列表、输入框、推理过程展示、工具调用卡片）、暗黑模式、Nuxt 4 兼容。

## 决策

**选择 Nuxt UI v4**，不选用 TDesign 或 shadcn-vue。

## 关键理由

1. **生产级 AI Chat 组件**：ChatMessages、ChatPrompt、ChatReasoning、ChatTool 等开箱即用，无需自建
2. **Nuxt 4 官方出品，原生集成**：通过 `@nuxt/ui` 模块注册，零手动配置
3. **暗黑模式**：语义化颜色系统，通过 `useColorMode()` 一行切换
4. **125+ 组件全部免费**（原 Pro 组件已开源）

## 为什么不选 TDesign

1. 非 Nuxt 原生，需手动插件注册
2. SSR 兼容性历史问题（Issue #3458 虽已关闭但无回归测试）
3. Chat 组件为 alpha 版本（0.3.0），有生产构建样式丢失反馈
4. 设计语言偏中后台（表格、表单），不适合 AI Chat 场景

## 为什么不选 shadcn-vue

- 无 AI Chat 组件，需自建（预估 2-4 周）
- 虽然灵活但开发效率远低于 Nuxt UI v4

## 代价

- 包体积中等（比 shadcn-vue 大，比 TDesign 小）
- 组件样式自定义需学习 `@nuxt/ui` 的 `ui` prop 系统
