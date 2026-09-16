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
| `drizzle-kit push` | 对比 Schema 文件与数据库，直接执行 DDL（**不记账**） | ✅ 是 | ⚠️ 仅原型期；**本项目已弃用** |
| `drizzle-kit generate` | 对比 Schema 与数据库，生成 SQL 迁移文件 | ❌ 否 | 需要版本化管理迁移时 |
| `drizzle-kit migrate` | 按**账本**执行"没记过账"的迁移（≠ 执行所有迁移文件） | ✅ 是 | 生产上线 |
| `drizzle-kit studio` | 启动本地 Web 数据库浏览器 | ❌ 否（只读浏览） | 随时（查看/验证数据） |

---

## push 的工作原理（⚠️ 本项目已弃用，仅作了解）

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
npx drizzle-kit migrate    # 按「账本」增量执行（不是把所有文件跑一遍）
```

`generate` 生成的迁移文件可以提交到 Git，实现数据库 Schema 的版本化管理。生产环境建议走 generate + migrate 流程而非直接 push。

### 生成的文件示例

```
server/db/migrations/
├── 0000_flimsy_iron_lad.sql   # 自动生成的 SQL DDL
└── meta/
    ├── _journal.json          # 每个迁移的文件名 + 生成时间（账本的 created_at 来源）
    └── 0000_snapshot.json     # 该迁移之后 schema 的快照（generate 靠它算出「差异」）
```

---

## 账本（ledger）—— migrate 的"进度记录"

**`migrate` 不是"把迁移文件执行一遍"，而是"照着账本，只执行还没记账的部分"。**

账本是数据库里的**一张普通表** `drizzle.__drizzle_migrations`（首次运行 migrate 时自动创建）：

| 列 | 含义 |
|---|---|
| `hash` | 该迁移文件**原始内容的 sha256** —— 文件的"身份证" |
| `created_at` | `meta/_journal.json` 里记录的该迁移生成时间 |

```
 id |              hash              |   created_at
----+--------------------------------+----------------
  1 | e34a0f8255a6abdcac14840fe...   | 1785079217167   ← 0000 做过了
  2 | 557f4673c06981204d613695f2...  | 1788447218139   ← 0001 做过了
```

所以每次 `migrate` 的行为是：

```
读账本 → 找出「有文件、但没记账」的迁移 → 只执行这些 → 追加账本记录
```

**这就是它为什么能反复运行** —— 做过的不再做第二遍。

### 为什么账本在 `drizzle` schema 下？

业务表（`chunks`/`documents`…）在 **`public`** schema，账本却在 **`drizzle`** schema —— 这是 drizzle 刻意隔离「工具元数据」与「业务数据」。

理解这条需要 PostgreSQL 的 **`search_path`（搜索路径）**：不写 schema 前缀时，PG 按它的顺序找表，默认值是 `"$user", public`：

```sql
select * from chunks;                         -- 走 search_path → public 里找到 ✅
select * from __drizzle_migrations;           -- 走 search_path → public 里没有 ✗ 报 42P01
select * from drizzle.__drizzle_migrations;   -- 带前缀 → 直达，跳过 search_path ✅
```

| schema | 来历 |
|---|---|
| `public` | PG **建库时自带**（owner `pg_database_owner`） |
| `drizzle` | **drizzle-kit 自建**（owner 是连接用户） |

所以"默认是 public"不是 public 特殊，而是 `search_path` 默认包含它。`drizzle` 也只是个**普通 schema**、没有强制机制 —— drizzle 放那儿纯粹是**自觉隔离**：不污染业务命名空间、不与用户表撞名、便于整体清理。

### ⚠️ 坑：`push` 不记账，两个命令混用会"对不上账"

| 命令 | 改数据库 | 记账 |
|---|:--:|:--:|
| `push` | ✅ | ❌ **不记** |
| `migrate` | ✅ | ✅ 记 |

**后果**：表若是 `push` 建的，账本会一直是空的。之后改用 `migrate` 时，它会认为"一个迁移都没做过"，于是**从 `0000` 开始重放** → 撞上已存在的表 → `relation "xxx" already exists`。

> 本项目真实踩过：2026-08-31 上线 Neon 时用 `push` 建表（[上线记录](../dev-log/2026-08-31-neon-rag-deployment.md)），账本从此为空；2026-09-15 想用 `migrate` 应用 `0002` 时才发现这笔欠账。

### 本地库和线上库是两套独立账本

`drizzle.config.ts` 读 `NUXT_DATABASE_URL` —— **换 URL 就换库**，而**每个库有自己独立的账本**。所以一次 schema 变更要在**每个环境各应用一次**（本地一次、线上一次），两边各自记账。

---

## 给已有数据库建立基线（baseline）

**场景**：库里的表是 `push` 建的（账本为空），现在想转用 `migrate`。

**做法**：把「历史上已经做过的迁移」补记进账本，之后 `migrate` 就只做新的。

> ⚠️ **前提**：先确认这些迁移对应的结构**确实已经在库里生效**。否则账本会"说谎"，后续迁移将建立在错误基线上。

### 第 0 步：账本表可能压根不存在

账本表是 **`migrate` 首次运行时自动创建**的。若某个库**从没跑过 migrate**（表全是 `push` 建的），那这张表还不存在 —— 直接查会报：

```
ERROR: relation "drizzle.__drizzle_migrations" does not exist (SQLSTATE 42P01)
```

**解决办法**：手动建（DDL 与 drizzle 自己建的一致），然后跳到第 2 步。

```sql
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id serial PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);
```

### 第 1 步：看账本现状

```sql
select id, left(hash, 12) as hash_prefix, created_at
from drizzle.__drizzle_migrations order by id;
```

### 第 2 步：生成补记录的 INSERT 语句

在项目根目录跑（自动读 `_journal.json` 并算出每个文件的 hash）：

```bash
node -e "
const {createHash}=require('crypto'), fs=require('fs');
const dir='server/db/migrations';
const j=JSON.parse(fs.readFileSync(dir+'/meta/_journal.json','utf8'));
const rows=j.entries.map(e=>'  (\''+createHash('sha256').update(fs.readFileSync(dir+'/'+e.tag+'.sql').toString()).digest('hex')+'\', '+e.when+')');
console.log('insert into drizzle.__drizzle_migrations (hash, created_at) values');
console.log(rows.join(',\n')+';');
"
```

> **原理**：账本的 `hash` = 迁移文件内容的 sha256，是**可计算的确定值**，不必手工拼。

**只想补一部分**？把输出里对应的行删掉即可。但注意：**已经手工执行过 SQL 的迁移也必须补记**，否则 `migrate` 会重放它。

### 第 3 步：在目标库执行，然后验证

把第 2 步的输出粘到目标库（Neon Console → SQL Editor，或本地 `psql`），再跑：

```bash
NUXT_DATABASE_URL="<目标库 URL>" npx drizzle-kit migrate
```

**期望**：`[✓] migrations applied successfully!`，且**不做任何改动**。

> 输出中夹带的 `NOTICE: relation "__drizzle_migrations" already exists, skipping` 是**正常的** —— 每次 migrate 都会尝试建这张表。

---

## 工作流

### 本地开发

```
定义/修改 schema.ts
      ↓
npx drizzle-kit generate     # 生成迁移文件
      ↓
npx drizzle-kit migrate      # 应用到本地库（记账）
      ↓
Nuxt dev 启动 → server/db/index.ts 连本地库（读写数据）
```

> ⚠️ **本地也建议用 migrate 而非 push** —— 否则本地账本同样会欠账：下次 `generate` 出迁移文件时，`migrate` 会重放它并撞上已存在的列。小步试错期用 `push` 图快可以，但代价是账本对不上，之后要补 baseline。

### 生产部署（推荐 generate + migrate）

> **关键点：迁移是手动操作，不是部署流水线的一环。** Cloudflare Workers 只运行应用代码（读写数据），不会自动建表。

```
修改 schema.ts
      ↓
npx drizzle-kit generate                                      # 生成 000N_xxx.sql（提交 Git）
      ↓
NUXT_DATABASE_URL="<Neon，URL 带 -pooler.>" npx drizzle-kit migrate   # 应用到线上（记账）
      ↓
git push → Cloudflare 自动部署
      ↓
应用上线，直接使用新表
```

**为什么生产用 `migrate` 而不是 `push`**：migrate 有账本 + 版本化文件，可审计、可追溯；push 直接比对 schema 改结构、**不留任何记录** —— 事后无法知道"线上是被改成了什么样"，也无法回滚。

> 若某个库的表最初是 `push` 建的、想转 migrate，先做上一节的 **baseline**。

### 一次 schema 变更的完整落地清单

> 适用：改了 `schema.ts`，且**已有数据需要跟着处理**（如新增列要给存量行补值）。纯新增列若不需回填，可跳过第 4/7 步。

**本地**

1. 改 `server/db/schema.ts`
2. `npx drizzle-kit generate` → 生成 `000N_xxx.sql`（提交 Git）
3. `npx drizzle-kit migrate` → 应用到本地库（**记账**）
4. 若需回填 → 跑回填脚本（见 [[drizzle-orm]] 批量回填模式）
5. 本地验证：`\d <表>` 看结构；跑业务验证

**线上**

6. `NUXT_DATABASE_URL="<Neon>" npx drizzle-kit migrate` → 应用到线上（记账）
7. 回填线上数据：`NUXT_DATABASE_URL="<Neon>" npx tsx scripts/backfill-xxx.ts`
8. **最后**才部署代码（`git push` → Cloudflare 自动部署）

### ⚠️ 顺序铁律：DDL → 回填 → 部署代码

| 顺序 | 结果 |
|---|---|
| **先部署代码、后建列** | ❌ 新代码 INSERT 一个**不存在的列** → 上传/写入直接报错 |
| **先建列、再部署代码** | ✅ 完全安全 —— 旧代码根本不碰新列，期间线上照常运行 |

**同一份代码要在每个环境各应用一次**（本地 + 线上），因为**每个库有自己独立的账本**。

**验证 migrate 真的记账了**：跑完后账本多一行；再跑一次应输出 `[✓] migrations applied successfully!` 且**不做任何改动**。

### 参数别写进 `.env`

`drizzle.config.ts` 读的是 `process.env.NUXT_DATABASE_URL`。指向线上时**用内联传参**：

```bash
NUXT_DATABASE_URL="<Neon>" npx drizzle-kit migrate     # ✅ 一次性，不留痕
```

改 `.env` 也能生效，但**用完必须改回来** —— 否则下次本地开发会连到线上库。

---

## 常见误区

| 误区 | 正解 |
|------|------|
| "改了 schema.ts，本地 dev 时表自动就有了" | 必须手动执行迁移 |
| "部署到 Cloudflare 时会自动建表" | Cloudflare 只运行应用，不执行 DDL |
| "drizzle-kit push 只能更新本地库" | 命令不区分环境，连到哪个 URL 就更新哪个 |
| **"`migrate` 会把所有迁移文件从头执行一遍"** | **不是。它按账本只执行「还没记账」的部分** |
| **"表是 push 建的，也能直接改用 migrate"** | **不行 —— 账本为空会让它从 `0000` 重放并报 `already exists`，要先 baseline** |
| **"本地 migrate 过了，线上就同步了"** | **本地和线上是两套独立账本，每个库都要各应用一次** |

---

## 相关文档

- [[drizzle-orm]] — ORM API 使用笔记（Schema 定义、CRUD、批量回填模式）
- [RAG 上线 Neon](../dev-log/2026-08-31-neon-rag-deployment.md) — 用 push 建表的那次上线（本次账本欠账的起点）
- [ADR-003: Neon + Drizzle ORM 选型](../decisions/003-neon-drizzle.md)
- [数据库开发规则](../../.claude/rules/database.md)
