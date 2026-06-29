# 2026-06-29 — SSR 安全的状态持久化：useCookie vs localStorage

> 从侧边栏折叠偏好的闪烁问题，一层层深入水合机制、预渲染与 SSR 的取舍。

---

## 讨论背景

桌面端侧边栏折叠偏好用 `localStorage` 持久化，在 `onMounted` 中读取。页面开启 `prerender: true`，导致每次加载侧边栏先展开再折叠——一次明显的 UI 闪烁。

## 核心结论

### 1. 闪烁根因：localStorage 在 SSR 中不可见

```
localStorage + onMounted：
  setup() → ref(false) → 首次渲染（展开）
  → onMounted → 读 localStorage → ref(true) → 再次渲染（折叠）
  → 👁️ 两帧之间用户看到了闪烁

useCookie：
  setup() → 读 document.cookie → ref(true) → 首次渲染（折叠）
  → 👁️ 一开始就是正确的，不闪
```

`useCookie` 在 `setup()` 阶段同步从 `document.cookie` 读取，不需要等 `onMounted`。即使后续水合修正也在同一帧完成，**浏览器来不及绘制错误状态**。

### 2. 水合（Hydration）机制

水合 = Vue 把服务端生成的静态 HTML "激活"为可交互组件的过程。Vue 在客户端重建虚拟 DOM，与现有 HTML 对比：

- **一致** → 挂载事件监听器，完成激活
- **不一致** → 报 hydration mismatch warning，丢弃服务端 HTML 重新渲染

常见触发水合错误的原因：

| 原因 | 示例 | 为什么不同 |
|------|------|-----------|
| 浏览器专属 API | `localStorage`, `sessionStorage` | 服务端不存在 |
| 时间/随机数 | `Date.now()`, `Math.random()` | 每次执行结果不同 |
| 客户端对象 | `window`, `navigator`, `matchMedia` | 服务端不存在 |
| 预渲染无请求上下文 | cookie, 请求头 | 构建时没有浏览器 |

### 3. 预渲染 vs SSR 的本质

**不是网络消耗的区别，是"什么时候生成 HTML"的区别：**

```
预渲染（构建时）：
  pnpm build → 跑一遍页面 → 生成 index.html → 部署到 CDN
  → 用户访问 → CDN 直接返回静态文件
  → 这份 HTML 对所有人都一模一样

SSR（请求时）：
  pnpm build → 编译代码，不生成 HTML
  → 用户访问 → Worker 执行 → 读 cookie → 渲染 HTML → 返回
  → 每个人拿到的 HTML 可以不同
```

| 维度 | 预渲染 | SSR |
|------|--------|-----|
| HTML 在哪生成 | 构建时一次生成 | 每次请求现场生成 |
| 能否访问 cookie | ❌ 构建时无请求 | ✅ 请求头带 cookie |
| 首字节时间 | ~10-50ms（CDN 分发） | ~50-200ms（执行+可能查 DB） |
| 个性化内容 | ❌ 只能展示默认状态 | ✅ 按用户状态渲染 |
| 适用场景 | 登录页、文档站、营销页 | Dashboard、聊天应用、设置页 |

**预渲染本身不产生水合错误**，但让服务端"看不见" cookie/偏好，导致服务端 HTML 和客户端状态可能不同，从而触发水合错误。

### 4. useCookie 的关键参数

```ts
const sidebarCollapsed = useCookie('sidebar-collapsed', {
  default: () => false,  // 工厂函数，避免 SSR 时对象引用不一致
  watch: true            // ref 值变化时自动写回 cookie（省掉手动 watch + set）
})
```

- `default` 用工厂函数 `() => false` 而非裸值 `false`：防止 SSR 时服务端和客户端返回不同对象引用
- `watch: true`：双向绑定——修改 ref 自动同步到 cookie，省掉原来 `watch` + `localStorage.setItem` 的 6 行手动回写

## 关键洞察

- **localStorage 无论开不开预渲染都消除不了闪烁**——服务端永远碰不到它。SSR 只是让服务端"有机会"读 cookie 来渲染正确 HTML，前提是偏好存在 cookie 里
- **`useCookie` 是 Nuxt 内置的 SSR 安全方案**——SSR 时从请求头读 cookie，客户端从 `document.cookie` 同步读取，两端都能拿到正确值
- **预渲染更适合内容对所有人都一样的页面**——如果页面有用户偏好、登录态等个性化内容，走 SSR 能从根本上消除水合 mismatch

## 相关文档

- [前端开发方案](2026-06-08-frontend-dev-plan.md)
- [Nuxt 4 学习笔记](../learning-notes/nuxt4-notes.md)
