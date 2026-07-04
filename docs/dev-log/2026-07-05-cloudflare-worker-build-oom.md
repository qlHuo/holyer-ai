# 2026-07-05 — Cloudflare Worker 构建 OOM：缺失 preset 引发的内存爆炸

> `node-server` preset 打包整个 `node_modules` → 2GB+ 堆内存耗尽。一行 `preset: 'cloudflare-module'` 解决，不需要改堆大小、不需要 wrangler 配置文件。

---

## 问题现象

```text
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

`pnpm build` 在 Nitro 打包阶段崩溃，内存冲到 ~2GB 后 Node.js 进程被杀。

---

## 根因分析

查看 `.output/nitro.json`：

```json
{
  "preset": "node-server",
  "framework": { "name": "nuxt", "version": "4.4.6" }
}
```

`nuxt.config.ts` 中没有声明 `nitro.preset`，Nitro 默认 fallback 到 `node-server`。这个 preset 的行为是：

1. **复制整个 `node_modules` 到输出目录** — `.output/server/node_modules/` 下有所有依赖
2. **打包过程处理全部依赖的依赖图** — 包括 `mermaid`（~1MB）、`postgres`（TCP 驱动）、`highlight.js` 等不应进入服务端 bundle 的包
3. **服务端代码不做 tree-shaking** — `import.meta.dev` 分支不会在生产构建中剔除

三道叠加，构建过程的内存消耗爆炸。

根因链条：

```
nuxt.config.ts 缺少 nitro.preset
  → Nitro 默认 node-server
    → 打包全部 node_modules
      → 堆内存超 2GB → OOM
```

---

## 解决方案

在 `nuxt.config.ts` 中声明正确的部署目标：

```ts
nitro: {
  preset: 'cloudflare-module',  // ← 一行修复
  esbuild: {
    options: {
      target: 'es2022'          // 支持 top-level await
    }
  }
}
```

### 为什么是 `cloudflare-module` 而不是 `cloudflare-pages`

| Preset | 部署目标 | 产物结构 | 静态资源 |
|--------|---------|---------|---------|
| `cloudflare-pages` | Cloudflare Pages Functions | `dist/_worker.js/` | Pages CDN 自动分发 |
| `cloudflare-module` | 独立 Cloudflare Worker | `dist/` 含 `wrangler.json` | Worker 自己 serve |
| `node-server`（默认） | Node.js 服务器 | `.output/server/index.mjs` | Node 服务 serve |

本项目部署到 **Cloudflare Workers**（独立 Worker，非 Pages），所以用 `cloudflare-module`。

### `cloudflare-module` 为什么没有 OOM

Nitro 知道目标环境是 Worker 后：

- **tree-shake 编译时分支**：`server/db/index.ts` 中 `import.meta.dev ? postgres-js : neon-http` 的 dev 分支被完全剔除，`postgres` 包不进入 bundle
- **客户端代码自然分离**：`mermaid`、`highlight.js` 仅在 `.vue` 组件中使用，不进入 Worker bundle
- **精确打包**：只打包服务端实际 `import` 链上的代码

| Preset | 打包范围 | 构建内存 |
|--------|---------|:--:|
| `node-server` | 整个 `node_modules` | ~2GB OOM |
| `cloudflare-module` | 仅服务端引用链 | <500MB |

---

## 不需要的"修复"

讨论过程中出现了两个不需要的方案：

### ❌ `NODE_OPTIONS="--max-old-space-size=8192"`

增加堆内存是治标。`node-server` 打包方式本身就是错误的——即使用 8GB 勉强构建成功，产物也无法部署到 Cloudflare Workers。正确的 preset 下 4GB 默认堆完全够用。

### ❌ 项目根 `wrangler.jsonc`

`cloudflare-module` preset 构建时会在 `dist/` 中自动生成 `wrangler.json`，不需要在项目根手动维护。项目根 `wrangler.jsonc` 只在需要声明 **Cloudflare 绑定**（KV、R2、D1、Queue 等）时才有意义，本项目使用 Neon PostgreSQL 作为外部数据库，不依赖这些绑定。

---

## Nitro Preset 选择决策树

```
项目部署到哪？
├── Node.js 服务器（VPS/Docker）
│   └── preset: 'node-server'
├── Cloudflare Pages（SSR 网站 + Functions）
│   └── preset: 'cloudflare-pages'
├── Cloudflare Workers（独立 Worker / API 服务）
│   └── preset: 'cloudflare-module'
├── Vercel
│   └── preset: 'vercel'
└── 其他平台（Netlify, Deno, AWS Lambda...）
    └── 对应 preset，见 Nitro 文档
```

**关键原则**：preset 必须在项目初期就配置好。缺失 preset 不只是"用默认值"——`node-server` 的打包策略与 Edge 平台完全不同，会导致构建失败或产物不可用。

---

## 补充：Nuxt 双管线构建架构

> 为什么 `nitro.preset` 只影响服务端打包，不影响前端？因为 Nuxt 的构建是两条完全独立的管线。

### 两条管线，各管各的

```
nuxt build
    │
    ├── Vite（客户端打包）
    │   ├── 入口：app/ 目录下所有 .vue/.ts 文件
    │   ├── 产物：.output/public/（静态 JS/CSS/HTML）
    │   └── 不管 nitro.preset 是什么，这一步完全一样
    │
    └── Nitro（服务端打包）
        ├── 入口：server/ 目录下所有 API 路由 + Service
        ├── 产物：dist/ 或 .output/server/
        └── preset 决定：打包策略、输出格式、平台适配代码
```

### preset 影响范围

| 关注点 | 由谁决定 | preset 影响？ |
|--------|---------|:---:|
| Vue 组件编译、Tree-shaking | Vite | 不影响 |
| CSS/Tailwind 处理 | Vite + PostCSS | 不影响 |
| 静态资源 hash、CDN 路径 | Vite | 不影响 |
| `app/` 下的代码分割 | Vite | 不影响 |
| **server/ 的打包策略** | **Nitro** | **✅ 影响** |
| **`import.meta.dev` 分支剔除** | **Nitro** | **✅ 影响** |
| **输出格式**（ESM/CJS/bundle） | **Nitro** | **✅ 影响** |
| **平台胶水代码**（`wrangler.json` 等） | **Nitro** | **✅ 影响** |

### `node-server` 为什么错得彻底

`node-server` preset 的行为是复制整个 `node_modules` 到输出目录。这意味着：

- `postgres`（TCP 驱动，Edge 不可用）→ 被复制
- `drizzle-kit`（CLI 工具，运行时不需要）→ 被复制
- `mermaid`（纯客户端库）→ 虽然不进服务端 bundle，但 Nitro 仍然扫描了整个依赖图

而 `cloudflare-module` 知道目标是 Worker，只打包 server 代码实际 `import` 链上的代码，其余全部 tree-shake 掉。这就是内存从 2GB 降到 500MB 以下的根本原因——不是"优化"了打包，而是**换了完全不同的打包策略**。

### 关键认知

**`nitro.preset` 不是"配置项"，而是"目标平台声明"**。它告诉 Nitro："你要生成的代码是跑在 Cloudflare Workers 上的，不是 Node.js 服务器上"。Nitro 据此选择完全不同的打包策略、平台适配代码和输出格式。缺失 preset 不等于"用默认配置"——等于"用错误的平台假设去构建"。

---

## 实际修改

| 文件 | 改动 | 说明 |
|------|------|------|
| `nuxt.config.ts` | 新增 `preset: 'cloudflare-module'` | 唯一需要的修改 |
| `package.json` | build 脚本保持 `nuxt build` | 不需要 `NODE_OPTIONS` 堆调整 |

---

## 相关文档

- [ADR-004 Cloudflare Pages 部署](../../docs/decisions/004-cloudflare-pages.md) — 原决策为 Pages，实际部署目标已调整为 Workers（此 ADR 的核心结论"选 Cloudflare"不变，具体产品从 Pages 调整为 Workers）
- [架构设计](../../.claude/plan/architecture.md) — 部署架构章节
- [Edge Runtime 约束](../../.claude/rules/edge-runtime.md) — Edge 环境限制
- [数据库规则](../../.claude/rules/database.md) — `import.meta.dev` 双驱动分支
