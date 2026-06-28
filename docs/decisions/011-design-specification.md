# ADR-011：设计规范体系

> 关联文档：[架构设计](../../.claude/plan/architecture.md) · [需求分析](../../.claude/plan/requirements.md)
> 任务编号：1.23
> 日期：2026-06-28

---

## 1. 设计方向

```
冷色暖质
  ├── 主色：天蓝（sky blue），富有科技感
  ├── 质感：柔和圆角 + 微妙阴影 + 毛玻璃过渡 → 中和冷色的距离感
  ├── 密度：宽松留白，内容呼吸感强
  ├── 动效：微交互点缀（hover / 消息进入 / 按钮反馈）
  └── 字体：Public Sans（保持），干净现代
```

### 为什么是这个方向

- **天蓝 + 科技感**：区别于 Nuxt UI 默认绿色，建立品牌识别；蓝色系天然关联"信任""技术"
- **冷色暖质**：AI 对话产品若纯冷色会产生距离感，通过圆角/阴影/玻璃质感注入温度——让产品看起来"聪明但不冷漠"
- **宽松留白**：日常使用的工具，呼吸感降低认知负荷，让对话内容成为焦点
- **微交互克制**：不喧宾夺主，仅在最需要反馈的触点加动效

---

## 2. 色彩体系

### 2.1 主色调：Sky Blue

采用 **Nuxt UI v4 内置 `sky` 色板** 作为基础，叠加自定义语义映射。

```
Nuxt UI 配置入口（app.config.ts）
  primary: 'sky'    → 自动生成 --ui-primary / --ui-primary-* 全系列
  neutral: 'zinc'   → --ui-bg / --ui-text / --ui-border 等（锌灰比 Slate 更暖）
```

> **为什么用 zinc 替代 slate？** Zinc 的灰色带有微弱暖底，配合天蓝主色时比 slate 的冷灰更"有机"，契合"冷色暖质"方向。

#### Sky 色板参考

| Token | 色值 | 用途 |
|-------|------|------|
| `sky-50` | `#f0f9ff` | 最浅底色 |
| `sky-100` | `#e0f2fe` | 悬浮 hover 背景 |
| `sky-200` | `#bae6fd` | 选中态背景 |
| `sky-300` | `#7dd3fc` | 边框强调 |
| `sky-400` | `#38bdf8` | 弱化主色 |
| `sky-500` | `#0ea5e9` | **主色基准** |
| `sky-600` | `#0284c7` | 深色悬停 |
| `sky-700` | `#0369a1` | 深色文字 |
| `sky-800` | `#075985` | 最深底色 |
| `sky-900` | `#0c4a6e` | — |
| `sky-950` | `#082f49` | 暗黑模式最深 |

### 2.2 语义色扩展

Nuxt UI 的 `primary` 色板不覆盖语义场景（成功/警告/错误/信息），需在 `main.css` 中补充：

```css
:root {
  /* 语义色 — 独立于主色，不随主题切换变化 */
  --color-success-50: #f0fdf4;
  --color-success-500: #22c55e;
  --color-success-700: #15803d;

  --color-warning-50: #fffbeb;
  --color-warning-500: #f59e0b;
  --color-warning-700: #b45309;

  --color-error-50: #fef2f2;
  --color-error-500: #ef4444;
  --color-error-700: #b91c1c;

  --color-info-50: #eff6ff;
  --color-info-500: #3b82f6;
  --color-info-700: #1d4ed8;
}
```

**使用原则**：
- 成功/警告/错误已有明确语义 → 直接使用对应变量
- 信息色仅用于非交互提示（如功能说明卡片），不与主色冲突
- `--ui-primary` 始终用于交互（按钮、链接、选中态），不与语义色混用

### 2.3 色彩切换机制

为满足"开发者快速切换颜色方案"，在 `main.css` 中建立一层**映射变量**：

```css
:root {
  /* 品牌色映射（切换主题时只需改这里的值） */
  --brand-50: var(--ui-primary-50);
  --brand-100: var(--ui-primary-100);
  --brand-200: var(--ui-primary-200);
  --brand-500: var(--ui-primary);
  --brand-600: var(--ui-primary-600);
  --brand-700: var(--ui-primary-700);
}
```

**切换方案只需两步**：
1. `app.config.ts` 改 `primary: 'violet'`（或其他内置色名）
2. `main.css` 无需改动——Nuxt UI 自动重新生成 `--ui-primary-*` 全系列，`--brand-*` 自动跟随

> 内置可选主色：`red` `orange` `amber` `yellow` `lime` `green` `emerald` `teal` `cyan` `sky` `blue` `indigo` `violet` `purple` `fuchsia` `pink` `rose`

---

## 3. 圆角体系

统一全局圆角变量，所有组件引用同一套 scale：

```css
:root {
  --radius-none: 0;
  --radius-xs: 0.25rem;   /* 4px  — 紧凑内元素 */
  --radius-sm: 0.375rem;  /* 6px  — 行内代码、标签 */
  --radius-md: 0.5rem;    /* 8px  — 按钮、输入框、气泡 */
  --radius-lg: 0.75rem;   /* 12px — 卡片、面板 */
  --radius-xl: 1rem;      /* 16px — 大面板、Modal */
  --radius-full: 9999px;  /*      — 头像、药丸按钮 */
}
```

**组件映射**：

| 组件 | 圆角 Token | 说明 |
|------|-----------|------|
| 消息气泡 | `--radius-lg` (12px) | 柔和圆角，契合"冷色暖质"的温暖取向 |
| 按钮 | `--radius-md` (8px) | Nuxt UI 默认（UButton 内置） |
| 输入框 | `--radius-lg` (12px) | 与气泡统一 |
| 对话列表项 | `--radius-lg` (12px) | 侧边栏选中项，与气泡统一 |
| 代码块 | `--radius-lg` (12px) | 与气泡同层级 |
| 头像 | `--radius-full` | 圆形 |
| Modal | `--radius-xl` (16px) | 弹出层最圆 |

**Tailwind 集成**：在 `@theme` 中注册为 Tailwind v4 可用类：

```css
@theme static {
  --radius-xs: 0.25rem;
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
}
```

---

## 4. 阴影体系

克制使用——仅在需要"抬升"元素以建立层级关系时加阴影：

```css
:root {
  /* 从低到高，表示离"纸面"的距离 */
  --shadow-none: none;
  --shadow-xs: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-sm: 0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.05);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.05);
  --shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.05);
}

.dark {
  /* 暗黑模式下阴影改为亮色叠加（比加深更自然） */
  --shadow-xs: 0 1px 2px 0 rgb(255 255 255 / 0.03);
  --shadow-sm: 0 1px 3px 0 rgb(255 255 255 / 0.04), 0 1px 2px -1px rgb(255 255 255 / 0.03);
  --shadow-md: 0 4px 6px -1px rgb(255 255 255 / 0.04), 0 2px 4px -2px rgb(255 255 255 / 0.03);
  --shadow-lg: 0 10px 15px -3px rgb(255 255 255 / 0.05), 0 4px 6px -4px rgb(255 255 255 / 0.03);
  --shadow-xl: 0 20px 25px -5px rgb(255 255 255 / 0.06), 0 8px 10px -6px rgb(255 255 255 / 0.03);
}
```

**使用场景**：

| 组件 | 阴影 | 场景 |
|------|------|------|
| 按钮 hover | `shadow-xs` | 轻微抬升反馈 |
| 选中对话项 | 无阴影 | 靠背景色区分，不抬升 |
| 下拉菜单 | `shadow-lg` | Popover 需要明显层级 |
| Modal 遮罩 | `shadow-xl` | 最高层级 |
| 代码块 hover | `shadow-sm` | 悬停时轻微浮起 |

---

## 5. 间距体系

基于 4px 基线网格，定义常用间距 token：

```css
:root {
  --space-0: 0;
  --space-1: 0.25rem;   /* 4px  — 极小间距 */
  --space-2: 0.5rem;    /* 8px  — 紧凑内边距 */
  --space-3: 0.75rem;   /* 12px — 列表项内边距 */
  --space-4: 1rem;      /* 16px — 标准内边距、组件间距 */
  --space-5: 1.25rem;   /* 20px — 稍宽间距 */
  --space-6: 1.5rem;    /* 24px — 段落间距、卡片 padding */
  --space-8: 2rem;      /* 32px — 大块间距 */
  --space-10: 2.5rem;   /* 40px — 区域间距 */
  --space-12: 3rem;     /* 48px — 页面级分隔 */
}
```

> **与 Tailwind 的关系**：Tailwind v4 的 `p-4`/`m-2` 等原子类自动映射到 4px 网格，与 token 体系天然一致。间距 token 主要用于：
> 1. 组件内需要跨元素保持一致的非标准间距
> 2. CSS 自定义属性场景（如 `gap: var(--space-3)`）
> 3. 文档化——让开发者一眼看到可用的间距值

---

## 6. 动效体系

### 6.1 缓动函数

```css
:root {
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);        /* 出场减速，弹性感 */
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);     /* 对称缓动 */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);  /* 微弹性（按钮/开关） */
}
```

### 6.2 时长

```css
:root {
  --duration-fast: 120ms;   /* 微交互：hover 颜色、图标切换 */
  --duration-base: 200ms;   /* 标准过渡：focus ring、展开/收起 */
  --duration-slow: 350ms;   /* 入场动画：消息出现、弹窗 */
}
```

### 6.3 动画工具类

```css
/* 消息入场 — 从下方淡入 */
@keyframes message-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-message-enter {
  animation: message-enter var(--duration-slow) var(--ease-out) both;
}

/* 骨架屏呼吸 */
@keyframes skeleton-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* 淡入 */
@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.animate-fade-in {
  animation: fade-in var(--duration-base) var(--ease-out) both;
}
```

### 6.4 应用位置

| 触点 | 动效 | 时长 |
|------|------|------|
| 消息气泡出现 | `animate-message-enter` + `animation-delay` 交错 | 350ms |
| 按钮 hover | `shadow-xs` + 背景色 transition | 120ms |
| 输入框 focus | ring 展开 + border 变色 | 200ms |
| 下拉菜单展开 | 从上方淡入 + 轻微位移 | 200ms |
| 骨架屏 | `skeleton-pulse` 呼吸 | 循环 |
| 对话列表 hover | 背景色 transition | 120ms |
| 侧边栏对话项选中 | 背景色 transition | 200ms |
| 暗黑模式切换 | Nuxt UI 内置 `--duration-base` | 200ms |

---

## 7. 排版体系

### 7.1 字体栈

```css
:root {
  --font-sans: 'Public Sans', ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-mono: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace;
}
```

保持 Public Sans 作为唯一正文字体。不引入第二字体，原因：
- 产品核心是对话内容，字体统一减少视觉噪音
- Public Sans 字重丰富（100-900），通过字重变化即可建立层级
- 减少字体加载量

### 7.2 字号/行高阶梯

```css
:root {
  /* 字号 */
  --text-xs: 0.75rem;     /* 12px — 辅助信息、时间戳 */
  --text-sm: 0.875rem;    /* 14px — 对话列表预览、按钮文字 */
  --text-base: 1rem;      /* 16px — 正文（消息内容） */
  --text-lg: 1.125rem;    /* 18px — 对话标题、面板标题 */
  --text-xl: 1.25rem;     /* 20px — 页面标题 */
  --text-2xl: 1.5rem;     /* 24px — Hero 标题 */

  /* 行高 */
  --leading-tight: 1.25;   /* 标题 */
  --leading-normal: 1.5;   /* 正文（消息内容） */
  --leading-relaxed: 1.625; /* 宽松段落 */
}
```

### 7.3 字重

```css
:root {
  --font-normal: 400;
  --font-medium: 500;    /* 按钮、标签 */
  --font-semibold: 600;  /* 标题 */
  --font-bold: 700;      /* 强调 */
}
```

### 7.4 排版组件映射

| 元素 | 字号 | 行高 | 字重 |
|------|------|------|------|
| 页面标题（Header） | `text-lg` (18px) | `leading-tight` | `semibold` |
| 对话列表标题 | `text-sm` (14px) | `leading-normal` | `medium` |
| 对话列表预览 | `text-xs` (12px) | `leading-normal` | `normal` |
| 消息正文 | `text-base` (16px) | `leading-relaxed` | `normal` |
| Markdown 标题 | 见 `.markdown-body h1-h6` | `leading-tight` | `semibold` |
| 按钮文字 | `text-sm` (14px) | — | `medium` |
| 输入框文字 | `text-sm` (14px) | — | `normal` |
| 时间戳 | `text-xs` (12px) | — | `normal` |

---

## 8. 滚动条定制

```css
/* 全局滚动条样式 */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background-color: var(--ui-border);
  border-radius: var(--radius-full);
}

::-webkit-scrollbar-thumb:hover {
  background-color: var(--ui-text-dimmed);
}

/* Firefox */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--ui-border) transparent;
}
```

- 宽度 **6px**（默认 ~16px 太粗，4px 太小难操作）
- 颜色跟随 Nuxt UI 语义 token，亮暗模式自动适配
- 圆角 `--radius-full` 呼应整体柔和质感

---

## 9. 焦点与可访问性

```css
:root {
  --focus-ring-width: 2px;
  --focus-ring-offset: 2px;
  --focus-ring-color: var(--ui-primary);
}

/* 全局 focus visible（键盘导航时显示，鼠标点击时不显示） */
*:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
  border-radius: var(--radius-xs);
}
```

> Nuxt UI 组件自带 `focus-visible` 处理，此处仅覆盖原始 HTML 元素（textarea、button 等）。

---

## 10. 暗黑模式补充

Nuxt UI v4 已处理大部分暗黑切换逻辑（`dark` class → `--ui-*` 变量自动切换）。需补充：

```css
.dark {
  /* 代码块背景在暗黑下略微增亮 */
  --code-block-bg: rgb(255 255 255 / 0.04);

  /* 暗黑下骨架屏颜色稍亮 */
  --skeleton-base: rgb(255 255 255 / 0.06);
  --skeleton-shine: rgb(255 255 255 / 0.1);
}

/* 亮色模式 */
:root {
  --code-block-bg: rgb(0 0 0 / 0.03);
  --skeleton-base: rgb(0 0 0 / 0.06);
  --skeleton-shine: rgb(0 0 0 / 0.1);
}
```

---

## 11. 文件修改计划

### 11.1 `app/app.config.ts` — 入口配置

```diff
- primary: 'green',
+ primary: 'sky',
- neutral: 'slate'
+ neutral: 'zinc'
```

### 11.2 `app/assets/css/main.css` — 核心规范落地

在现有基础上追加以下区块：

1. **@theme 扩展** — 注册 radius/spacing/shadow/animation 变量到 Tailwind
2. **设计 Token** — `:root` 块中定义全部 CSS 自定义属性
3. **语义色板** — success/warning/error/info 完整色阶
4. **动效定义** — `@keyframes` + 工具类
5. **滚动条样式** — Webkit + Firefox
6. **焦点样式** — `focus-visible` 全局
7. **暗黑补充** — `.dark` 下的自定义 token
8. **代码块背景** — 替换 `color-mix(...)` 为 `var(--code-block-bg)`

### 11.3 实施记录

分两阶段完成：

#### 第一阶段：Token 层 + 配置入口（2026-06-28）

`app.config.ts` 改为 `sky` + `zinc`，`main.css` 追加全部 CSS 自定义属性（语义色、圆角 scale、阴影体系、缓动/时长、品牌映射、动效 keyframes、滚动条、焦点样式、暗黑覆写）。详见上文 §11.1–11.2。

#### 第二阶段：组件改造（2026-06-28）

将组件中硬编码 Tailwind 值替换为设计 token 引用：

| 文件 | 改动 |
|------|------|
| `MessageBody.vue` | `rounded-lg` → `rounded-(--radius-lg)`；错误态颜色全部替换为语义 token（`border-error-500`、`bg-error-50`、`text-error-700`）；添加 `shadow-(--shadow-sm)` |
| `ChatInput.vue` | textarea `rounded-lg` → `rounded-(--radius-lg)`；添加 `transition-shadow duration-(--duration-fast)` |
| `ChatPanel.vue` | 4 处骨架屏 USkeleton `rounded-lg` → `rounded-(--radius-lg)`；欢迎页添加 `animate-fade-in` |
| `LayoutSidebar.vue` | 列表项 `rounded-lg` → `rounded-(--radius-lg)`；错误态颜色 `--ui-color-error-400` → `text-error-500` |
| `ChatMessage.vue` | 外层 div 添加 `animate-message-enter`（消息从下方 8px 淡入） |
| `ChatMessageActions.vue` | toast `color: 'success'` → `color: 'primary'`（与 sky 主色统一） |
| `MarkdownContent.vue` | toast `color: 'success'` → `color: 'primary'` |
| `ADR-011`（本文件） | 圆角映射表更新：消息气泡/输入框/列表项统一为 `--radius-lg` (12px) |

**Token 引用规范**（Tailwind CSS v4 语法）：
- 圆角：`rounded-(--radius-lg)`
- 语义色：`border-error-500`、`bg-error-50`（自动识别 `--color-error-*` CSS 变量）
- 带透明度：`border-error-500/40`
- 阴影：`shadow-(--shadow-sm)`（亮暗双模自适应）
- 时长：`duration-(--duration-fast)`

### 11.4 设计审计与修复（2026-06-28）

组件改造完成后进行了全面审计，发现并修复以下问题：

| 问题 | 严重度 | 修复 |
|------|:---:|------|
| Sidebar 错误态颜色用长格式 `--ui-color-error-*`，与 MessageBody 的短格式不一致 | P0 | 统一为 `text-error-500` |
| ChatInput 焦点环无过渡，突然出现 | P1 | 添加 `transition-shadow` + `--duration-fast` |
| 消息气泡零阴影，"冷色暖质"中"暖质"太弱 | P1 | 添加 `shadow-(--shadow-sm)` |
| 欢迎页无入场动画，闪现突兀 | P2 | 添加 `animate-fade-in` |
| ADR 圆角映射表与实际代码不一致 | P2 | 更新为 `--radius-lg` (12px) |

### 11.5 新增文档

- `docs/decisions/011-design-specification.md`（本文件）— 设计规范 ADR
- 关联进度更新：`CLAUDE.md`、`.claude/plan/roadmap.md`

---

## 12. 验证清单

- [x] `app.config.ts` 改为 `primary: 'sky', neutral: 'zinc'`
- [x] `main.css` 追加全部 CSS 自定义属性
- [x] `npx nuxi typecheck` 通过
- [x] 开发服务器启动，亮色模式：消息气泡/按钮/输入框主色为天蓝
- [x] 暗黑模式切换：所有颜色跟随，无硬编码颜色残留
- [x] 滚动条：6px 宽，圆角，颜色跟随主题
- [x] 快速切换主色测试：`app.config.ts` 改 `primary: 'violet'` → 全站主色变为紫色，无需改动其他文件
- [x] 语义色：toast error 颜色正确显示，success 改为 primary（sky blue）
