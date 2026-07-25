/// <reference types="node" />
/**
 * Drizzle Kit 配置文件
 *
 * 1. 生效机制
 * - 由 drizzle-kit CLI 直接读取（不经过 Nuxt / Nitro / 项目 tsconfig）
 * - 运行时环境是纯 Node.js（`process` 全局可用，`process.env` 无运行时问题）
 * - 配置文件发现优先级：drizzle.config.ts > drizzle.config.js > drizzle.config.json
 * - 只需放在项目根目录，drizzle-kit 自动从 CWD 向上查找
 *
 * 2. 与 Nuxt 的关系
 * - Nuxt 通过 server/db/index.ts 中的 drizzle-orm 连接数据库，不经过 drizzle-kit
 * - drizzle-kit 仅在开发/部署时手动执行命令（generate / migrate / push）
 * - 两者唯一交集：server/db/schema.ts —— Nuxt 用于 ORM 查询，drizzle-kit 用于 DDL 迁移
 *
 * 3. TS 编辑器报 process 红线
 * - 仅因文件不在 Nuxt 的 tsconfig include 范围内，@types/node 未被加载
 * - 运行时无影响，消除方式：`pnpm add -D @types/node` + 文件头加 `/// <reference types="node" />`
 */
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.NUXT_DATABASE_URL!
  }
})
