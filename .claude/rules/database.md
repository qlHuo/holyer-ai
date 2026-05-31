---
paths:
  - "server/db/**"
  - "drizzle.config.ts"
---

# 数据库规则

## 驱动（硬性约束）

**只能使用 `drizzle-orm/neon-http`**，严禁以下任何替代：

- ❌ `drizzle-orm/pg`
- ❌ `drizzle-orm/node-postgres`
- ❌ `drizzle-orm/postgres-js`

原因：Edge Runtime 不支持 TCP Socket，仅 HTTP 驱动 (`neon-http`) 兼容 Cloudflare Workers。

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

- 环境变量名：`DATABASE_URL`
- 必须使用 Neon 连接池化 URL（含 `-pooler.` 段），用于 HTTP 连接
- 开发和生产使用不同的 Neon 分支

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
