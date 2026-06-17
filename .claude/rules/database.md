---
paths:
  - "server/db/**"
  - "drizzle.config.ts"
---

# 数据库规则

## 驱动

| 环境 | 驱动 | 连接方式 |
|------|------|---------|
| 本地开发 (Node.js) | `drizzle-orm/postgres-js` | TCP 直连 localhost |
| 生产 (Cloudflare Workers) | `drizzle-orm/neon-http` | HTTP 直连 Neon |

`server/db/index.ts` 通过 `import.meta.dev` 编译时常量自动分支，Vite 在生产构建中剔除 dev 分支及所有依赖包。

**严禁以下替代：**
- ❌ `drizzle-orm/pg`
- ❌ `drizzle-orm/node-postgres`

原因：`drizzle-orm/pg` 和 `node-postgres` 依赖 Node.js 原生模块（`pg-native`），Edge Runtime 无法运行且本地安装复杂。`postgres-js` 是纯 JS 实现，Node.js 和 Edge 运行时都兼容。

## 导入方式

```ts
// ✅ 正确：从服务端共享实例导入（路径依实际目录层级调整）
import { db } from '../server/db'
// 或使用 Nitro 自动别名（在 server/** 中）：
import { db } from '~~/server/db'

// ❌ 错误：自己创建连接
import { neon } from '@neondatabase/serverless'
const sql = neon(process.env.DATABASE_URL!)
```

## 连接字符串

- 环境变量名：`NUXT_DATABASE_URL`
- **本地开发**：`.env` 中指向 `postgres://postgres:postgres@localhost:5432/holyer`
- **生产环境**：Cloudflare Pages Dashboard 注入，指向 Neon 连接池化 URL（含 `-pooler.` 段）
- 环境变量通过 `nuxt.config.ts` 中的 `runtimeConfig.databaseUrl` 暴露

## 查询模式

- 使用 Drizzle 类型安全 API（`db.select().from()` / `db.insert().values()`），不写原始 SQL
- 所有 Schema 定义在 `server/db/schema.ts` 中
- Schema 变更后运行 `npx drizzle-kit generate` 生成迁移

## 迁移

```bash
npx drizzle-kit generate   # 生成迁移文件
npx drizzle-kit migrate    # 执行迁移
npx drizzle-kit push       # 开发阶段快速推送（跳过迁移文件）
```
