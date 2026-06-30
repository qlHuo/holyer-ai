# 2026-07-01 — Markdown 渲染与 Mermaid 图表完整实现

> AI 对话中的富文本渲染是整个应用的信息呈现核心。markdown-it 负责将模型输出的 Markdown 源码转为 HTML，mermaid 负责将图表源码转为可视化 SVG——二者组合构成了"从文本到可视化"的完整渲染管线。

---

## 1. 功能背景与场景分析

### 1.1 为什么需要 Markdown 渲染

LLM 返回的消息几乎总是 Markdown 格式：标题、列表、代码块、表格、链接、引用块等。如果只做 `whitespace-pre-wrap` 纯文本展示，可读性极差——用户无法快速扫视结构化信息，代码块也没有语法高亮。

### 1.2 为什么需要 Mermaid

模型在解释架构、流程、时序、状态机等概念时，经常输出 Mermaid 图表源码。如果不渲染，用户看到的只是一段 `graph TD` 或 `sequenceDiagram` 文本，完全丧失可视化价值。

### 1.3 典型场景矩阵

| 场景 | 触发时机 | 渲染策略 |
|------|---------|---------|
| **流式输出中** | 模型逐 token 输出，消息内容不断追加 | Markdown 实时渲染；Mermaid **跳过**，显示为代码块样式，避免 SVG 每 token 反复重建 |
| **流式结束** | SSE 流 `done` 事件触发 | watch 检测到 `isStreaming: true → false`，统一触发 Mermaid 渲染 |
| **历史对话加载** | 页面刷新、SSR hydration、侧边栏切换对话 | `onMounted` 触发初始扫描，渲染所有未处理的 `.mermaid` 元素 |
| **消息重新生成** | 用户点击重新生成按钮 | 内容被替换，watch 再次触发 |
| **暗黑模式切换** | 用户切换或系统主题变化 | Mermaid 重新初始化，按新主题重渲染（当前未实现自动重渲染） |

---

## 2. 整体架构

```
模型输出（Markdown 文本）
       │
       ▼
┌─────────────────────────┐
│  markdown-it 渲染引擎    │  ← app/utils/markdown.ts (单例)
│  ├ highlight.js 高亮    │
│  ├ fence → 代码块包裹   │
│  └ fence → mermaid <pre> │
└───────────┬─────────────┘
            │ HTML 字符串
            ▼
┌─────────────────────────┐
│  MarkdownContent.vue     │  ← 组件层
│  ├ computed: renderedHtml│
│  ├ v-html 渲染           │
│  ├ renderMermaidDiagrams │  ← 双触发器驱动
│  └ 代码块复制委托         │
└───────────┬─────────────┘
            │ DOM 操作
            ▼
┌─────────────────────────┐
│  mermaid 11.x           │  ← 客户端动态 import
│  ├ initialize (全局1次)  │
│  └ render(id, code)     │  ← 逐元素渲染为 SVG
└─────────────────────────┘
```

### 2.1 关键设计决策

**markdown-it 而非 marked/markdown-it-async**

理由：markdown-it 是 Vue/Nuxt 生态最主流的 Markdown 解析器，有完善的 TypeScript 类型支持、丰富的插件生态、灵活的 renderer rules 扩展机制。`html: false` 配置天然防 XSS（所有原始 HTML 被转义），安全性优于更宽松的 marked。

**`<pre>` 而非 `<div>` 作为 Mermaid 容器**

mermaid 11.x 通过 `element.innerHTML` 读取图表源码（而非 `textContent`）。`<pre>` 保留换行和缩进空白符，`<div>` 会将连续空白规范化为单个空格，导致 `graph TD\n    A --> B` 被解析为 `graph TD A --> B`，语法错误。详见 [第 5.1 节](#51-bug-1mermaidrun-预设-data-processed-导致失败后无法重试)。

**客户端动态 import 而非全局加载**

mermaid 体积约 1MB（含解析器 + 所有图表类型），仅在页面中存在 `.mermaid` 元素时才动态加载，避免所有页面都承担加载成本。

---

## 3. markdown-it 渲染管线

### 3.1 核心配置

```ts
// app/utils/markdown.ts
const md = new MarkdownIt({
  html: false,      // 禁止原始 HTML（防 XSS）
  linkify: true,    // 自动识别 URL 为链接
  breaks: true,     // 单换行 → <br>（符合聊天习惯）
  highlight         // 代码块语法高亮回调
})
```

### 3.2 自定义 renderer rules

| 规则 | 功能 |
|------|------|
| `link_open` | 外部链接（http/https）自动添加 `target="_blank" rel="noopener noreferrer"` |
| `image` | 所有图片添加 `loading="lazy"` |
| `fence` | 代码块包裹 `.code-block-wrapper`（含语言标签 + 复制按钮）；mermaid 语言输出 `.mermaid` 容器 |

### 3.3 代码块结构

fence renderer 输出的 HTML 结构：

```html
<div class="code-block-wrapper">
  <div class="code-block-header">
    <span class="code-lang">javascript</span>
    <button class="code-copy-btn" data-code="[HTML 编码的源码]" title="复制代码">
      <span class="code-copy-icon"></span>
    </button>
  </div>
  <pre><code class="hljs language-javascript">[highlight.js 高亮后的 HTML]</code></pre>
</div>
```

复制按钮的原始代码通过 `data-code` 属性传递——用 HTML 实体编码存储，复制时解码还原。

### 3.4 安全考量

- `html: false` 确保用户输入中不会出现原始 HTML 注入
- `v-html` 仅用于渲染 markdown-it 的输出——markdown-it 本身已将所有用户 HTML 转义，因此 `v-html` 在此处是安全的（区别于直接 `v-html` 渲染原始用户输入）
- `securityLevel: 'strict'` 限制 Mermaid 的交互能力——不执行 `<script>`、不加载外部资源

---

## 4. Mermaid 渲染引擎

### 4.1 双触发器设计

Mermaid 渲染最大的难点是**需要等 DOM 就绪**——元素必须已被 `v-html` 渲染到页面上，Mermaid 才能读取 `innerHTML` 并替换为 SVG。

在 Nuxt 4 SSR 环境下，存在两种 DOM 就绪的触发路径：

```
路径 A：SSR hydration（历史消息、页面刷新）
  SSR HTML 到达 → Vue hydration → 组件挂载 → onMounted 触发

路径 B：流式完成（实时对话）
  SSE token 到达 → content 更新 → computed 重算 → v-html 重绘
  → watch([renderedHtml, isStreaming]) 触发
```

**单触发器不够**：`watch({flush:'post'})` 在 SSR hydration 期间可能不触发（computed 的首次求值不被视为"变更"），而流式结束恰巧靠 `isStreaming: true→false` 的二次触发才能工作。因此采用双触发器覆盖所有场景。

```ts
// 触发器 1：SSR hydration / 历史加载
onMounted(() => {
  if (props.isStreaming) return
  renderMermaidDiagrams()
})

// 触发器 2：流式完成 / 内容变更
watch([renderedHtml, () => props.isStreaming], async ([, streaming]) => {
  if (streaming) return
  await renderMermaidDiagrams()
}, { flush: 'post' })
```

### 4.2 逐元素渲染

不使用 `mermaid.run({nodes})`，改用 `mermaid.render(id, code)` 逐元素处理。原因见 [第 5.1 节](#51-bug-1mermaidrun-预设-data-processed-导致失败后无法重试)。

```ts
for (const mermaidEl of mermaidEls) {
  const code = (mermaidEl.textContent ?? '').trim()
  // 先尝试原始代码，失败则自动修复后重试
  let svg: string
  try {
    ;({ svg } = await mermaid.render(id, code))
  } catch {
    const sanitized = sanitizeMermaidCode(code)
    ;({ svg } = await mermaid.render(id, sanitized))
  }
  mermaidEl.innerHTML = svg
  mermaidEl.setAttribute('data-processed', 'true')
}
```

### 4.3 流式期间跳过

流式输出中，如果 Mermaid 代码块尚未闭合，每次 token 到达都重新渲染会导致：
- SVG 每几百毫秒重建，CPU 消耗高
- 视觉闪烁——代码块 → SVG → 代码块 → SVG 反复切换
- 可能因语法不完整而反复出错

因此 `isStreaming=true` 时直接 return，等流式结束后再统一渲染。未渲染的 `.mermaid` 元素通过 CSS 显示为代码块样式（等宽字体 + 背景色），给用户"图表正在加载"的视觉预期。

---

## 5. 三个 Bug 及其根因与修复

### 5.1 Bug 1：`mermaid.run()` 预设 `data-processed` 导致失败后无法重试

**现象**：首次渲染失败后，图表永久显示为源码，刷新页面也无法恢复。

**根因**：阅读 mermaid 11.16.0 打包源码（第 191722 行），`mermaid.run()` 在调用 `render()` **之前**就已设置 `data-processed="true"`。如果 render 抛出异常，元素的 `data-processed` 已被标记，但 `innerHTML` 仍为空。下一次尝试（如刷新、切换对话回来后）CSS 选择器 `.mermaid:not([data-processed])` 不再匹配该元素，重试永远不可能。

```
mermaid.run() 执行顺序：
  1. 遍历 nodes → 对每个 node 设置 data-processed="true"  ← 问题在这里
  2. 调用 mermaid.render()
  3. 将 SVG 写入 node.innerHTML
  4. 如果步骤 3 抛异常 → data-processed 已设置，innerHTML 为空
```

**修复**：放弃 `mermaid.run()`，改用 `mermaid.render(id, code)` 逐元素调用，**仅渲染成功后才设置 `data-processed`**。

### 5.2 Bug 2：AI 生成的 Mermaid 语法错误——特殊字符未引用

**现象**：`Syntax error in text, mermaid version 11.16.0. Expecting 'SQE', ... got 'PS'`，发生在有 `()` 或 `<>` 的未引用标签中。

**根因**：Mermaid 的节点标签语法 `A[label text]` 中，如果标签包含 `()` 或 `<>` 且未用双引号包裹，解析器会将 `(` 视为语法 token 而非字面文本。AI 模型输出的图表经常出现此类标签（如 `B[setup() <br/> 入口]`）。

**修复**：添加 `sanitizeMermaidCode()` 函数，用正则 `\[([^\]"]+?)\]` 匹配未引用的方括号内容，若包含 `()`/`<>` 则自动加双引号：

```ts
function sanitizeMermaidCode(code: string): string {
  return code.replace(/\[([^\]"]+?)\]/g, (_match, content) => {
    if (/[()<>]/.test(content)) {
      return `["${content}"]`
    }
    return _match
  })
}
```

采用 **原始代码优先、失败后 sanitize 重试** 的两步策略，避免对正常代码过度修改。

### 5.3 Bug 3：历史对话中 Mermaid 显示源码而非 SVG

**现象**：实时流式生成时图表正常渲染为 SVG，但查看历史对话（页面刷新、切换对话）时又变回源码。

**根因**：这是三个 Bug 中最隐蔽的一个，涉及 Vue 3 `watch` 与 Nuxt SSR hydration 的时序交互。

1. **Nuxt 4 开启了 SSR**（默认），服务端会执行 `computed` → 生成 HTML → 发送给客户端
2. 客户端 hydration 阶段，Vue 重建组件实例，`computed` 求值得到与 SSR 相同的值
3. **`watch` 的 `flush: 'pre'`（默认）在 DOM 更新前触发**——但 SSR hydration 时，computed 的首次求值可能不被视为"变更"，watch 回调静默跳过
4. 即使使用 `flush: 'post'`，SSR hydration 期间的 watch 行为仍不可靠——Vue 的响应式系统在 hydration 复用时采取了特殊优化，某些情况下首次 computed 不触发 watch

**为什么流式场景碰巧能工作**：流式过程中 `isStreaming` 一直为 true，Mermaid 被跳过。当流结束时 `isStreaming` 从 true 变为 false——这是一个显式的**二次变更**，watch 能可靠捕获到。

**修复**：引入 `onMounted` 作为第一触发器——它在 SSR hydration 完成后**必定触发**，不依赖响应式变更检测。与原有的 `watch` 形成互补：

| 触发器 | 覆盖场景 | 原理 |
|--------|---------|------|
| `onMounted` | 页面刷新、SSR hydration、历史对话切换 | 生命周期保证，与 watch 时序无关 |
| `watch` (`flush:'post'`) | 流式结束、消息重新生成 | 处理挂载后的动态内容变更 |

额外添加 `rendering` 锁（布尔标志），防止两个触发器在极短时间内同时触发导致并发渲染。

---

## 6. 代码块复制按钮的图标渲染问题

### 6.1 问题

fence renderer 中使用了 `<span class="code-copy-icon i-lucide-copy w-3.5 h-3.5">`，但图标不显示。`i-lucide-copy` 是 UnoCSS presetIcons 的类名，依赖构建时 CSS 生成。

### 6.2 根因

UnoCSS 扫描源码文件生成图标 CSS，但 fence renderer 返回的是 JavaScript 字符串，通过 `v-html` 运行时注入 DOM。这是一个"编译时扫描 vs 运行时渲染"的脱节：

- Nuxt UI v4 的 `UIcon` 组件（在 `.vue` template 中使用）能正常工作——Vue 编译器处理模板，UnoCSS 可扫描到
- `v-html` 中的类名——不经过 Vue 编译器和 UnoCSS 扫描，CSS 可能不生成
- SSR 首屏 HTML 更不可能包含这些 CSS 规则

### 6.3 解决方案对比

| 方案 | 实现 | 优点 | 缺点 |
|------|------|------|------|
| **A: UnoCSS safelist** | `unocss.safelist: ['i-lucide-copy']` | 官方推荐 | 需确认 Nuxt UI v4 暴露 safelist 配置 |
| **B: 隐藏模板占位** | 在 template 中放 `<span class="hidden i-lucide-copy">` | 1 行代码，零配置 | workaround，新增图标需记得加 |
| **C: mask-image CSS** ✅ | CSS 中用 `mask-image` + SVG data URI | 零依赖，100% 确定 | CSS 中出现 data URI，不够美观 |
| **D: Vue 组件替代 v-html** | markdown AST → Vue VNode 渲染器 | 完全 Vue-native | Phase 1 改动太大 |

**当前采用方案 C（mask-image CSS）**——改动最小、确定性最高。`.code-copy-icon` 用 `mask-image` 内联 Lucide Copy SVG，`currentColor` 自动适配亮暗主题。后续如新增更多 v-html 动态图标，可升级到方案 A（safelist）。

---

## 7. CSS 架构

### 7.1 关键样式规则

```
.code-copy-icon              ← mask-image 自渲染图标（方案 C）
.code-copy-btn / :hover      ← 复制按钮交互态
.code-block-wrapper          ← 代码块容器（圆角、边框、溢出隐藏）
.code-block-header           ← 语言标签 + 复制按钮行
.code-block-wrapper pre      ← 代码区域（滚动、背景）
.mermaid:not([data-processed]) ← 未渲染的 Mermaid（代码块样式）
.mermaid[data-processed]     ← 已渲染的 Mermaid（居中 flex）
```

### 7.2 设计 token 使用

所有样式使用项目统一的设计 token（`--ui-*`、`--radius-*`、`--duration-*`、`--font-mono`），确保与 Nuxt UI v4 组件视觉一致。详见 [ADR-011 设计规范体系](docs/decisions/011-design-specification.md)。

---

## 8. 未来扩展方向

### 8.1 Mermaid 图表增强（优先级排序）

#### P0：暗黑模式自动切换（低复杂度）

当前 Mermaid 初始化时设置 `theme: 'dark' | 'default'`，但切换主题后已渲染的 SVG **不会自动重渲染**——因为 `data-processed` 已标记。

**方案**：监听 `colorMode` 变化 → 移除所有 `.mermaid[data-processed]` 的 `data-processed` 属性 → 重新调用 `renderMermaidDiagrams()`。实现约 10 行。

#### P1：图表交互增强

| 功能 | 实现方式 | 复杂度 |
|------|---------|--------|
| **弹窗放大** | 点击图表 → 打开 Dialog/Modal，显示完整尺寸 SVG；`.mermaid` 点击事件委托，Teleport 到 body 下 | 中 |
| **缩放控制** | `transform: scale()` + `transform-origin: center`，滑块或滚轮控制，弹窗模式下生效 | 中 |
| **下载 PNG/SVG** | Canvas 绘制 SVG → `toBlob()` → `URL.createObjectURL()` → `<a download>`；或直接 `new Blob([svgString])` 下载 .svg | 低 |
| **源码 ↔ 图表切换** | 每个图表旁加切换按钮，存储原始 `code`（在 `data-raw-code` 属性或组件状态中），切换时互换 `innerHTML` | 低 |
| **一键复制源码** | 复用现有 `navigator.clipboard.writeText()` 模式 | 低 |

#### P2：图表类型扩展

- **错误态优化**：Mermaid 解析失败时，显示友好的错误提示 + "查看源码"按钮，而非静默保留代码块
- **渲染进度指示**：多图表页面逐个渲染时显示进度（如 "3/5 图表已渲染"）
- **Kroki 集成**：除 Mermaid 外，支持 PlantUML、D2、GraphViz 等图表语言（Kroki 统一 API），满足不同用户偏好

#### P3：性能优化

- **虚拟滚动懒渲染**：长对话中仅渲染可视区域的图表，`IntersectionObserver` 触发
- **Worker 内渲染**：将 Mermaid 移至 Web Worker，避免阻塞主线程
- **SVG 缓存**：相同源码的图表只渲染一次，`Map<codeHash, svgString>` 缓存

### 8.2 Markdown 渲染增强

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **数学公式 (KaTeX)** | markdown-it-texmath 插件，学术/技术讨论场景刚需 | P1 |
| **任务列表** | `- [ ]` / `- [x]` 渲染为 checkbox | P1 |
| **脚注** | markdown-it-footnote 插件 | P2 |
| **Emoji** | markdown-it-emoji 插件 | P2 |
| **自定义容器** | `:::tip` / `:::warning` / `:::danger` 语法（markdown-it-container），用于 Agent 提示和 Skill 输出 | P2 |
| **Diff 高亮** | markdown-it 插件解析 ` ```diff ` 代码块，绿/红标注增减行 | P2 |
| **目录生成** | `[[toc]]` 自动提取标题生成目录，长文档导航 | P3 |

### 8.3 架构演进：从 v-html 到 Vue AST 渲染

当前 `markdown-it → HTML 字符串 → v-html` 的管道简单高效，但有两类限制：
1. **v-html 内容无法使用 Vue 组件**（如 `UIcon`、Vue Toast）
2. **事件处理靠 DOM 委托**（`@click="handleClick"`）

如果未来需要更丰富的交互（如工具调用卡片可展开/折叠、内联 Agent 状态），可以演进为：

```
markdown-it → Token[] → Vue h() 函数 → VNode[] → 渲染
```

这是 Phase 2 Agent UI 需要评估的方向，当前管线在 Phase 1 范围内足够使用。

---

## 9. 关键洞察

1. **Mermaid 渲染的难点不在 Mermaid 本身，在"何时渲染"**——30% 的代码是 Mermaid API 调用，70% 是解决 Vue/SSR/响应式系统中的 DOM 就绪时序
2. **`<pre>` vs `<div>` 的选择不是风格问题，是 Mermaid 内部实现决定的**——`mermaid.render()` 第 191722 行通过 `innerHTML` 读取源码，`<div>` 会让换行和缩进丢失
3. **v-html 是一个实用的"快速通道"**，但它的边界很明显——不能用于需要 Vue 组件、UnoCSS 图标类、或精细事件处理的场景
4. **双触发器是 SSR 框架中的常见模式**——不是 Vue 的 bug，而是 SSR hydration 的响应式语义天然模糊（首次求值算"初始化"还是"变更"？）
5. **sanitize 优于 validate**——与其告诉模型"你的 Mermaid 语法有问题"，不如自动修正常见错误。AI 输出的语法质量不可控，容错比报错更有价值

---

## 相关文档

- [ADR-011 设计规范体系](../decisions/011-design-specification.md) — CSS token 层定义
- [流式架构 V2](2026-06-27-stream-architecture-v2.md) — `isStreaming` 状态管理
- [SSR 状态 hydration](2026-06-29-ssr-state-hydration.md) — Nuxt 4 SSR 水合机制
- [前端开发方案](2026-06-08-frontend-dev-plan.md) — Markdown 渲染的初始规划
- [Phase 1 审查报告](2026-06-18-phase1-review.md) — 1.26 Mermaid 渲染任务定义
