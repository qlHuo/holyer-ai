# Drizzle ORM 知识笔记

> drizzle-orm 是 Drizzle 的 TypeScript ORM 库。本文以项目实际代码为例，记录常用 API 模式和使用场景。CLI 工具（建表、迁移）见 [[drizzle-kit]]。

---

## 导入约定

项目中 ORM 相关导入分三类，各有用途：

| 导入路径 | 用途 | 示例 |
|---------|------|------|
| `drizzle-orm/pg-core` | Schema 定义（列类型、表定义函数） | `pgTable`, `uuid`, `varchar`, `text`, `timestamp`, `index` |
| `drizzle-orm` | 查询运算符和过滤器 | `eq`, `desc`, `and`, `or`, `sql` |
| `drizzle-orm/postgres-js` 或 `drizzle-orm/neon-http` | 创建 DB 实例（按环境分支） | `drizzle(sql, { schema })` |

**实际代码示例**：

```typescript
// Schema 文件 — server/db/schema.ts
import { pgTable, uuid, varchar, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core'

// Service 文件 — server/service/prompts/queries.ts
import { desc, eq } from 'drizzle-orm'

// DB 实例 — server/db/index.ts
import { drizzle } from 'drizzle-orm/postgres-js'    // dev
import { drizzle } from 'drizzle-orm/neon-http'     // prod
```

---

## Schema 定义

### 常用列类型

Drizzle 的 `pgTable` 列定义格式：`columnName: typeName('db_column_name', options?)`

| Drizzle 类型 | 对应 PostgreSQL | 常用场景 |
|-------------|----------------|---------|
| `uuid('id').defaultRandom().primaryKey()` | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` | 主键 |
| `varchar('name', { length: 255 })` | `VARCHAR(255)` | 短文本（名称、标题） |
| `text('description')` | `TEXT` | 长文本（正文、描述） |
| `timestamp('created_at').defaultNow()` | `TIMESTAMP DEFAULT now()` | 时间戳 |
| `integer('count')` | `INTEGER` | 整数 |
| `boolean('is_active')` | `BOOLEAN` | 布尔值 |
| `jsonb('metadata')` | `JSONB` | JSON 数据 |

### JS 属性名 vs 数据库列名

```typescript
name: varchar('name', { length: 255 })
//  ↑ JS 属性名         ↑ 数据库列名（字符串参数）
```

- **JS 属性名**（`name:`）：代码中访问时的 key，如 `prompts.name`
- **数据库列名**（`'name'`）：数据库中实际的列名，如 `SELECT name FROM prompts`

两者可以不同，但约定俗成写一样——便于维护和排查。需要不同时也可以显式区分：

```typescript
displayName: varchar('prompt_name', { length: 255 })  // DB 列名为 prompt_name
```

### 默认值 & 自动生成

| 写法 | 效果 | 项目实例 |
|------|------|---------|
| `.defaultRandom()` | 自动生成随机 UUID | `prompts.id` |
| `.defaultNow()` | 插入时自动设为当前时间 | `prompts.createdAt` |
| `.default('')` | 固定字符串默认值 | `prompts.description` |
| `.default('新对话')` | 固定字符串默认值 | `conversations.title` |
| `.default(sql`NOW()`)` | SQL 表达式作为默认值 | 未使用（用 `.defaultNow()` 替代） |

### 链式修饰符

列定义通过链式调用添加约束，项目常用组合：

```typescript
// 完整链式：类型 + 非空 + 默认值
title: varchar('title', { length: 255 }).notNull().default('新对话')

// 外键 + 级联删除
conversationId: uuid('conversation_id')
  .references(() => conversations.id, { onDelete: 'cascade' })
  .notNull()

// 可选列（无 notNull）
toolCalls: jsonb('tool_calls')
```

### 索引定义

索引通过 `pgTable` 的第三个参数（table extras）定义：

```typescript
export const messages = pgTable('messages', {
  // ...列定义
}, table => ({
  conversationIdx: index('idx_messages_conversation_id').on(table.conversationId),
  createdAtIdx: index('idx_messages_created_at').on(table.createdAt)
}))
```

**命名约定**：索引名用 `idx_表名_列名` 格式，便于排查。

---

## 数据库实例（双驱动）

项目根据运行环境自动选择驱动，`import.meta.dev` 是 Vite 编译时常量：

```typescript
// server/db/index.ts
const db = import.meta.dev
  ? await createDevDb(config.databaseUrl)    // 本地：TCP 直连
  : await createProdDb(config.databaseUrl)   // 生产：HTTP 直连 Neon

// 开发环境
async function createDevDb(url: string) {
  const { default: postgres } = await import('postgres')
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const sql = postgres(url, {
    max: 10,              // 最大连接数
    idle_timeout: 30,     // 空闲超时 (s)
    connect_timeout: 5    // 连接超时 (s)
  })
  return drizzle(sql, { schema })
}

// 生产环境
async function createProdDb(url: string) {
  const { neon } = await import('@neondatabase/serverless')
  const { drizzle } = await import('drizzle-orm/neon-http')
  const sql = neon(url)
  return drizzle(sql, { schema })
}
```

**关键点**：
- 生产驱动**必须**用 `drizzle-orm/neon-http`，禁止 `pg` / `node-postgres`
- 本地用 `postgres-js`（纯 JS 实现，Edge 兼容）
- 动态 `import()` 确保 Vite 在生产构建中剔除 dev 分支的依赖包
- `{ schema }` 传入让 drizzle 知道所有表结构，支持关系查询

---

## CRUD 操作

以下示例全部来自 `server/service/prompts/`，是项目中的实际代码。

### SELECT — 列表查询

```typescript
import { db } from '~~/server/db'
import { prompts } from '~~/server/db/schema'
import { desc } from 'drizzle-orm'

// 部分列选择 + 排序
const rows = await db.select({
  id: prompts.id,
  name: prompts.name,
  description: prompts.description,
  createdAt: prompts.createdAt,
  updatedAt: prompts.updatedAt
}).from(prompts).orderBy(desc(prompts.updatedAt))
```

**模式要点**：
- `db.select({ col1, col2 })` 做**部分列选择**，只查需要的字段
- `.orderBy(desc(prompts.updatedAt))` 按更新时间倒序
- 返回值类型由选择的列自动推导

### SELECT — 单条查询

```typescript
import { eq } from 'drizzle-orm'

const [row] = await db.select({
  id: prompts.id,
  name: prompts.name,
  // ...
}).from(prompts).where(eq(prompts.id, id))

if (!row) return null
```

**模式要点**：
- `eq(prompts.id, id)` 是等值过滤，等价于 `WHERE id = $1`
- 解构 `const [row]` 取第一行，数组为空时 `row` 为 `undefined`
- 判空后返回 `null`，由上层 API 路由决定返回 404

### INSERT — 创建

```typescript
const [row] = await db
  .insert(prompts)
  .values({
    name: data.name,
    description: data.description,
    prompt: data.prompt
  })
  .returning()
```

**模式要点**：
- `.returning()` 是 **PostgreSQL 专有特性**（MySQL/SQLite 不支持），INSERT 后直接返回插入的完整行
- 不需要再查一次——`returning()` 一次搞定，省一次数据库往返
- 返回值是数组，`const [row]` 取第一条
- 只传业务字段（name、description、prompt），`id` 和 `createdAt` 由数据库默认值自动生成

### UPDATE — 更新

```typescript
const [row] = await db
  .update(prompts)
  .set({
    name: data.name,
    description: data.description,
    prompt: data.prompt,
    updatedAt: new Date()  // 手动更新 updatedAt
  })
  .where(eq(prompts.id, id))
  .returning()

if (!row) return null
```

**模式要点**：
- `updatedAt` 需要**手动传入 `new Date()`**——Drizzle 的 `.defaultNow()` 只在 INSERT 时生效
- `.returning()` 同样适用，返回更新后的完整行
- `where(eq(...))` 限定更新范围，不匹配时 `row` 为 `undefined`

### DELETE — 删除

```typescript
const deleted = await db
  .delete(prompts)
  .where(eq(prompts.id, id))
  .returning()

return deleted.length > 0
```

**模式要点**：
- `.returning()` 在 DELETE 中也有效，返回被删除的行
- 用 `.length > 0` 判断是否删到了东西，比 `row` 判空更直观

---

## 常用运算符

项目当前使用的运算符，更多参见 [Drizzle 文档 - Operators](https://orm.drizzle.team/docs/operators)：

| 运算符 | 导入 | 等价 SQL | 使用场景 |
|--------|------|---------|---------|
| `eq(table.col, value)` | `drizzle-orm` | `col = value` | 等值过滤（WHERE id = $1） |
| `desc(table.col)` | `drizzle-orm` | `ORDER BY col DESC` | 倒序排列 |
| `asc(table.col)` | `drizzle-orm` | `ORDER BY col ASC` | 正序排列 |

---

## 类型转换模式

Drizzle 返回的时间列是 JavaScript `Date` 对象，而 API 契约类型使用 ISO 字符串。**转换在 Service 层完成**：

```typescript
// ❌ 错误：直接将 Date 对象返回给前端
return rows  // createdAt 是 Date，JSON 序列化后格式不可控

// ✅ 正确：Service 层做转换
return rows.map(row => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt.toISOString(),   // Date → ISO 8601 字符串
  updatedAt: row.updatedAt.toISOString()
}))
```

**为什么在 Service 层而不是 API 路由层？**
- API 路由只负责参数验证 + 调用 Service + 响应包装
- 类型转换是业务逻辑的一部分，属于 Service 层职责
- API 路由拿到的已经是干净的共享类型，不需要知道数据库列的原始类型

---

## 分层架构全景

以 prompts 模块为例，完整调用链路：

```
请求                         响应
  │                           ▲
  ▼                           │
┌─────────────────────────────────────────┐
│ API 路由 (server/api/prompts/)          │
│ - Zod 验证请求体                         │
│ - 调用 Service 函数                      │
│ - successResponse() / throw createError  │
│ 禁止直接 import db                       │
└──────────────┬──────────────────────────┘
               │
  ┌────────────▼──────────────────────────┐
  │ Service 层 (server/service/prompts/)  │
  │ - queries.ts: 只读操作                 │
  │ - mutations.ts: 写操作                 │
  │ - 类型转换: Date → ISO string          │
  │ - 返回共享类型 (PromptDetail 等)        │
  └────────────┬──────────────────────────┘
               │
  ┌────────────▼──────────────────────────┐
  │ Drizzle ORM (server/db/)              │
  │ - schema.ts: 表结构定义                │
  │ - index.ts: db 实例 (双驱动)           │
  └────────────┬──────────────────────────┘
               │
  ┌────────────▼──────────────────────────┐
  │ PostgreSQL / Neon                      │
  └────────────────────────────────────────┘
```

---

## 常见问题

| 问题 | 答案 |
|------|------|
| `.returning()` 在 MySQL 能用吗？ | 不能，这是 PostgreSQL 专有特性 |
| `updatedAt` 为什么更新时不自动变？ | `.defaultNow()` 只在 INSERT 时生效，UPDATE 需手动传 `new Date()` |
| 为什么 Service 文件要分 queries 和 mutations？ | 只读和写入关注点分离，queries 不会引入副作用，便于测试和审查 |
| 为什么不直接 `select *`？ | 部分列选择减少数据传输量，且显式声明让 Drizzle 推导更准确的返回类型 |
| 生产环境为什么不能 `postgres-js`？ | `postgres-js` 依赖 TCP Socket（`net` 模块），Edge Runtime 不提供 |

---

## 相关文档

- [[drizzle-kit]] — CLI 工具用法（push、generate、migrate、studio）
- [数据库开发规则](../../.claude/rules/database.md)
- [Edge Runtime 约束](../../.claude/rules/edge-runtime.md)
- [API 路由与 Service 层规范](../../.claude/rules/api-conventions.md)
