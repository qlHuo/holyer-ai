# 2026-08-31 — RAG 上线 Neon：部署流程与网络踩坑

> 核心洞察：本地 Docker 和线上 Neon 是**两个独立的库**，RAG 流程（建表/灌库）要在 Neon 上重跑一遍；且灌库脚本连 Neon 必须走 **HTTP（neon-http）而非 TCP（postgres-js）**——中国到 AWS 的 TCP 5432 会被重置。

---

## 讨论背景

阶段 A 在本地 Docker 验证通过（92% 召回），要上线需把数据推到 Neon。本地验证过的三件事，在 Neon 上要重做：启用 pgvector、建表、灌库。

## 部署流程（3 步）

### 1. Neon 启用 pgvector

Neon Console → SQL Editor 执行：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

**必须早于建表**——`chunks.embedding` 是 `vector(1024)` 列，扩展没启用时建表报 `type "vector" does not exist`。

### 2. 推送表结构

```powershell
$env:NUXT_DATABASE_URL = "postgresql://...-pooler...neon.tech/db?sslmode=require"
npx drizzle-kit push
```

### 3. 灌库

```powershell
$env:NUXT_DATABASE_URL = "postgresql://...-pooler...neon.tech/db?sslmode=require"
npx tsx scripts/ingest-docs.ts
```

脚本里 `process.loadEnvFile('.env')` **不覆盖已设置的环境变量**，所以 `$env:` 前缀能让脚本指向 Neon，而非 `.env` 里的本地串。

## 关键踩坑：TCP 5432 被重置，必须走 HTTP

第一次灌库报错：

```
ECONNRESET: Client network socket disconnected before secure TLS connection was established
```

排查过程（两次误判，值得记录）：

1. **先以为 SSL 配置** → 给 postgres-js 加 `ssl: 'require'` → **无效**
2. **定位真根因**：postgres-js 走 TCP 5432，中国到 AWS 的 TCP 连接被重置；而生产环境一直用 neon-http（HTTPS 443）能正常工作

**修复**：灌库脚本按 URL 选驱动——Neon 走 neon-http（HTTP），本地 Docker 走 postgres-js（TCP）：

```ts
const isNeon = DB_URL.includes('neon.tech')
if (isNeon) {
  db = drizzleNeon(neon(DB_URL), { schema })       // HTTP 443
} else {
  const sql = postgres(DB_URL, { max: 10 })
  db = drizzlePostgres(sql, { schema })             // TCP 5432
  closeConnection = () => sql.end()
}
```

## 关键洞察

- **本地/线上是两个独立库**，流程各跑一遍；灌库脚本通过 URL 判断目标库、自动选驱动
- **连接串必须 `-pooler`**：生产 neon-http 只走连接池化 URL；`?sslmode=require` 是 Neon 强制 SSL 的要求
- **网络类报错优先怀疑"协议/端口"而非"配置"**：`ECONNRESET` 是连接被重置，换协议（TCP→HTTP）比调配置（SSL 参数）更可能对症

## 相关文档

- [local-db-docker-migration](2026-08-30-local-db-docker-migration.md) — 本地库迁移 Docker（互补，本地侧）
- [rag-stage-a-implementation](2026-08-31-rag-stage-a-implementation.md) — 阶段 A 落地（灌库脚本的上下文）
- [cf-workers-subrequest-limit](2026-09-01-cf-workers-subrequest-limit.md) — 上线后的 subrequest 超限排查（Agent 增量写入代价）
- [cloudflare-edge-notes](../learning-notes/cloudflare-edge-notes.md) — Edge 双驱动约束
