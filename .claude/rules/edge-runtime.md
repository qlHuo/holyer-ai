---
paths:
  - "server/**"
---

# Edge Runtime 约束

Cloudflare Workers 生产环境不提供 Node.js 运行时，以下 API **不可用**：

## 禁用的 Node.js 核心模块

| API | 替代方案 |
|-----|---------|
| `fs` / `fs/promises` | R2 对象存储 或 Neon 数据库 |
| `child_process` | 不支持，MCP 仅走 HTTP/SSE |
| `worker_threads` | 不支持，用异步 API |
| `net` (TCP Socket) | 所有外部通信用 `fetch()` / HTTP |
| `__dirname` / `__filename` | 用 `import.meta.url` |

## 新依赖检查清单

引入任何新 npm 包时确认：
1. 不依赖以上 Node.js 核心模块
2. 包文档标注了 "Edge" 或 "Workers" 兼容
3. 在 `npx wrangler pages dev dist/` 中验证无运行时错误

## 已知兼容的包

- `drizzle-orm/neon-http` ✅
- `@neondatabase/serverless` ✅
- `openai` (v4+ 默认使用 `fetch` API) ✅
- `@anthropic-ai/sdk` ⚠️ 使用 `fetch`，引入前在 `wrangler pages dev` 验证

Nuxt 4 Nitro 已处理大部分兼容性适配，常规业务代码无需特殊处理。
