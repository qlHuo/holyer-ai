# Drizzle Kit 知识笔记

> drizzle-kit 是 Drizzle ORM 的 CLI 工具，负责数据库 Schema 变更管理。本文聚焦 CLI 命令、配置和工作流。ORM API 用法见 [[drizzle-orm]]。

---

## 配置文件

本项目 `drizzle.config.ts`：

```typescript
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './server/db/schema.ts',   // Schema 定义文件
  out: './server/db/migrations',     // 迁移文件输出目录
  dialect: 'postgresql',             // 数据库方言
  dbCredentials: {
    url: process.env.NUXT_DATABASE_URL!  // 数据库连接字符串（环境变量注入）
  }
})
```

关键点：
- `schema` 指向项目唯一的 Schema 文件，kit 对比此文件与数据库
- `out` 是 `generate` 命令的输出目录，可提交到 Git 做版本化管理
- `dialect` 固定为 `postgresql`，与 Neon 兼容
- `dbCredentials.url` 读环境变量，**不同环境设不同 URL 即指向不同库**

---

## 核心命令对比

| 命令 | 作用 | 改动数据库？ | 适用阶段 |
|------|------|:---:|---------|
| `drizzle-kit push` | 对比 Schema 文件与数据库，直接执行 DDL | ✅ 是 | 开发迭代，快速建表/改表 |
| `drizzle-kit generate` | 对比 Schema 与数据库，生成 SQL 迁移文件 | ❌ 否 | 需要版本化管理迁移时 |
| `drizzle-kit migrate` | 执行已有迁移文件 | ✅ 是 | CI/CD 或生产上线 |
| `drizzle-kit studio` | 启动本地 Web 数据库浏览器 | ❌ 否（只读浏览） | 随时（查看/验证数据） |

---

## push 的工作原理

`drizzle-kit push` 本身**不区分本地或生产**。它读取 `drizzle.config.ts` 中的环境变量决定连哪个库。**同一个命令，换 URL 就指向不同库：**

```bash
# 本地数据库
NUXT_DATABASE_URL=postgres://postgres:postgres@localhost:5432/holyer npx drizzle-kit push

# 线上 Neon 数据库
NUXT_DATABASE_URL=postgresql://xxx-pooler.neon.tech/holyer npx drizzle-kit push
```

### push 行为细节

- **新增表/列** → 自动创建
- **删除列** → 不会自动删（安全考虑），需手动处理或 `drizzle-kit push --force`
- **类型变更** → 尝试 ALTER COLUMN，不兼容时会报错提示手动处理
- **索引变更** → 自动同步

---

## studio — 可视化数据库浏览器

```bash
npx drizzle-kit studio
```

启动后浏览器打开 `https://local.drizzle.studio`，可以：
- 浏览所有表及其数据
- 手动增/删/改数据行
- 过滤、排序、搜索

效果类似 TablePlus / phpMyAdmin，优势是 Drizzle 原生集成，无需额外配置连接。

---

## generate + migrate — 版本化迁移

```bash
npx drizzle-kit generate   # 生成 SQL 迁移文件 → server/db/migrations/
npx drizzle-kit migrate    # 执行迁移文件
```

`generate` 生成的迁移文件可以提交到 Git，实现数据库 Schema 的版本化管理。生产环境建议走 generate + migrate 流程而非直接 push。

### 生成的文件示例

```
server/db/migrations/
└── 0000_flimsy_iron_lad.sql   # 自动生成的 SQL DDL
```

---

## 工作流

### 本地开发

```
定义/修改 schema.ts → drizzle-kit push（指向本地 PostgreSQL）
                              ↓
                        Nuxt dev 启动 → server/db/index.ts 连到本地库（读写数据）
```

### 生产部署

> **关键点：push 是手动操作，不是部署流水线的一环。** Cloudflare Workers 只运行应用代码（读写数据），不会自动建表。

```
修改 schema.ts → 手动 drizzle-kit push（指向 Neon 生产库，URL 带 -pooler.）
                       ↓
                  线上表结构已更新
                       ↓
                 git push → Cloudflare 自动部署
                       ↓
                  应用上线，直接使用新表
```

---

## 常见误区

| 误区 | 正解 |
|------|------|
| "改了 schema.ts，本地 dev 时表自动就有了" | 必须手动执行 `drizzle-kit push` |
| "部署到 Cloudflare 时会自动建表" | Cloudflare 只运行应用，不执行 DDL |
| "drizzle-kit push 只能更新本地库" | 命令不区分环境，连到哪个 URL 就更新哪个 |

---

## 相关文档

- [[drizzle-orm]] — ORM API 使用笔记（Schema 定义、CRUD、查询模式）
- [ADR-003: Neon + Drizzle ORM 选型](../decisions/003-neon-drizzle.md)
- [数据库开发规则](../../.claude/rules/database.md)
