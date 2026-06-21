# 2026-06-02 — 代码规范配置：ESLint 统一管理质量与风格

> 不用 Prettier。在 Nuxt 4 项目中，ESLint 一条命令就能同时管代码质量和格式化——这是 2025+ 的推荐做法。

---

## 讨论背景

项目已有 `@nuxt/eslint` + ESLint v10 基础设施，但仅启用了两条 stylistic 规则。需要为项目建立完整的代码规范体系，并决定是否引入 Prettier。

核心结论已在 [ADR-010](../decisions/010-eslint-over-prettier.md) 中记录。本文档聚焦配置实现细节。

---

## 核心结论

### 1. 三层配置架构

```
nuxt.config.ts          → 声明式配置（stylistic 选项 + formatters 开关）
    │
    ▼  nuxt prepare 生成
.nuxt/eslint.config.mjs → Nuxt 自动生成的 flat config（插件组合 + globs + 全局变量）
    │
    ▼  withNuxt() 导入
eslint.config.mjs       → 用户自定义规则（分层：TS / Vue / 通用）
```

每一层的职责：

| 层 | 文件 | 职责 |
|----|------|------|
| **声明式** | `nuxt.config.ts` | 统一管理 stylistic 选项（引号、分号、缩进…）和 formatters（CSS/HTML/MD），一处改全局生效 |
| **自动生成** | `.nuxt/eslint.config.mjs` | Nuxt 内置的插件组合（TypeScript + Vue + Import + 全局变量），不手工修改 |
| **用户自定义** | `eslint.config.mjs` | 项目特有的业务规则，按文件类型分层 |

### 2. 为什么 `@stylistic/eslint-plugin` 能替代 Prettier

| Prettier 功能 | ESLint `@stylistic` 对应规则 |
|--------------|----------------------------|
| 缩进宽度 | `indent` |
| 引号（单/双） | `quotes` |
| 分号 | `semi` |
| 尾逗号 | `comma-dangle` |
| 大括号位置 | `brace-style` |
| 箭头函数括号 | `arrow-parens` |
| 空格（对象/逗号/操作符） | `key-spacing` / `comma-spacing` / `space-infix-ops` |
| JSX 格式化 | `jsx-*` 系列 |

外加 `eslint-plugin-format`（`formatters` 特性）：
- CSS / SCSS / Less → `format/prettier`（Prettier 内置的 CSS 解析器）
- HTML → `format/prettier`
- Markdown → 默认关闭（Prettier 会破坏表格排版，且不支持 MDC）

### 3. `@typescript-eslint/consistent-type-imports` 不能用的原因

```ts
// 这个规则在 @typescript-eslint v8 中需要 parserOptions.project（类型感知 linting）
'@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }]
```

**问题**：在 flat config 中应用于 `.md` 文件（使用 `parser-plain`）时爆炸，因为纯文本解析器无法提供类型信息。

**决策**：暂时不启用此规则。类型感知 linting 需要额外配置 `parserOptions.project`，会拖慢 lint 速度。等项目代码量增长到需要时再启用。

### 4. `_this` 变量不是 bug

`server/service/llm/deepseek.ts` 中的 `const _this = this` 触发了 `no-this-alias` 规则：

```ts
// ReadableStream 的 start() 是方法简写而非箭头函数，this 指向上层对象而非类实例，必须预先捕获
// eslint-disable-next-line @typescript-eslint/no-this-alias
const _this = this
```

详见 [2026-06-02 类型安全审查](2026-06-02-type-safety-review.md#已验证无问题审查中的误判)。

### 5. `files.associations` 与 `eslint.validate` 的语言 ID 冲突

**问题表现**：CI 报 CSS `format/prettier` 错误，但本地 VS Code 保存时不报错、不自动修复。

**根因**：两行配置互相矛盾——

```json
// .vscode/settings.json
"eslint.validate": ["css", ...],          // ← 只认 language ID "css"
"files.associations": { "*.css": "tailwindcss" }  // ← 把 .css 映射成 "tailwindcss"
```

执行链路：
```
保存 .css 文件
  → VS Code 按 files.associations 识别语言为 "tailwindcss"
  → ESLint 在 eslint.validate 中找 "tailwindcss" → 未找到
  → 跳过该文件（不检查、不修复）
  → push 到 CI，eslint . 命令行不管语言映射，直接扫 .css
  → 15 个 format/prettier 错误全暴露
```

**修复**：在 `eslint.validate` 中补齐被 `files.associations` 重映射的语言 ID：

```json
"eslint.validate": [
  "css",
  "tailwindcss",  // ← 与 files.associations 的 "*.css": "tailwindcss" 对应
  ...
]
```

**通用原则**：每次在 `files.associations` 中新增一个映射，都要检查对应的语言 ID 是否在 `eslint.validate` 中——否则该类文件在编辑器内会被 ESLint 静默跳过。

---

## 配置清单

### `nuxt.config.ts` — 声明式配置

```ts
eslint: {
  config: {
    stylistic: {
      commaDangle: 'never',
      braceStyle: '1tbs',
      semi: false,
      quotes: 'single',
      indent: 2,
      arrowParens: false,
      quoteProps: 'consistent-as-needed',
      blockSpacing: true,
    },
    formatters: {
      css: true,
      html: true,
      markdown: false, // Prettier 会破坏表格排版，且不支持 MDC
    }
  }
}
```

### `eslint.config.mjs` — 分层自定义规则

| 层级 | 文件范围 | 规则 |
|------|---------|------|
| TypeScript | `*.ts, *.tsx, *.vue` | `no-explicit-any` (warn)、`no-unused-vars`（忽略 `_` 前缀） |
| Vue | `*.vue` | `define-macros-order`、`prefer-import-from-vue`、`no-unused-refs`、`require-default-prop` |
| 通用 | 所有文件 | `no-console` (warn)、`prefer-const`、`object-shorthand` |

### VS Code 集成

`.vscode/settings.json`：
- `editor.formatOnSave: false` — 关闭默认格式化器
- `editor.codeActionsOnSave.source.fixAll.eslint: "explicit"` — 保存时 ESLint 自动 fix
- `eslint.validate` — 覆盖所有需要 lint 的文件类型

`.vscode/extensions.json` — 推荐 ESLint、Vue (Volar)、Tailwind CSS IntelliSense

### `package.json` 脚本

```json
"lint": "eslint .",
"lint:fix": "eslint . --fix"
```

---

## 关键洞察

- **`nuxt.config.ts` 的 `eslint.config` 是唯一真相源**：stylistic 选项改一处，`nuxt prepare` 后全局生效，不需要在多个配置文件中同步
- **formatters 是惊喜但 markdown 要关**：CSS 和 HTML 用 ESLint 格式化工作良好；Markdown 表格被 Prettier 破坏（这是 `@nuxt/eslint` 默认关闭它的原因——不是因为不需要，而是因为 Prettier 不懂 MDC）
- **`files` 过滤是规则分层的关键**：TS 规则必须加 `files: ['**/*.ts', '**/*.tsx', '**/*.vue']`，否则 ESLint 会把它们应用到 `.md` 文件并因缺少 TS parser 而报错
- **不要一上来就启用类型感知 linting**：`consistent-type-imports` 是好规则，但它强制要求 `parserOptions.project`，会导致 lint 速度下降 3-5 倍。等项目代码量超过 50 个文件时再评估
- **`files.associations` 会静默破坏 ESLint**：VS Code 按语言 ID 匹配 `eslint.validate`，而 `files.associations` 会改变文件的语言 ID——两者不同步时，该类文件在编辑器内被完全跳过，直到 CI 才暴露

## 相关文档

- [ADR-010: ESLint stylistic rules 替代 Prettier](../decisions/010-eslint-over-prettier.md)
- [2026-06-02 类型安全审查](2026-06-02-type-safety-review.md)
- [架构设计](../../.claude/plan/architecture.md)
