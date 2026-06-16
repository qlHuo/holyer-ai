# ADR-003: Neon PostgreSQL + Drizzle ORM

> 日期：2026-05-31 · 状态：✅ 已采纳

---

## 背景

需要为应用选择数据库。核心需求：对话记录持久化、向量搜索（RAG 阶段）、Cloudflare Workers Edge Runtime 兼容、低供应商锁定。

## 决策

**选择 Neon（Serverless PostgreSQL）+ Drizzle ORM (neon-http)**，不选用 Supabase 或 Cloudflare D1 + Vectorize。

## 对比

| 维度 | Neon | Supabase | Cloudflare D1 + Vectorize |
|------|:---:|:---:|:---:|
| 数据库类型 | PostgreSQL | PostgreSQL | SQLite |
| 向量搜索 | ✅ pgvector | ✅ pgvector | ✅ Vectorize |
| 免费额度 | 0.5GB 存储 | 500MB DB | 5GB + 100万向量 |
| Edge 兼容 | ✅ HTTP 驱动 | ⚠️ 需 HTTP | ✅ 原生 |
| 供应商锁定 | **低**（标准 PG） | 低（标准 PG） | **高**（专有） |
| ORM 支持 | ✅ Drizzle (neon-http) | ✅ Drizzle (pg) | ✅ Drizzle (d1) |

## 关键理由

1. **标准 PostgreSQL**：不锁定供应商，未来可迁移到 Supabase、自建 PG 等
2. **HTTP 驱动直连**：`@neondatabase/serverless` + `drizzle-orm/neon-http`，Cloudflare Workers Edge Runtime 原生兼容（不需要 TCP Socket）
3. **pgvector 成熟稳定**：向量搜索经过大量生产验证
4. **免费层够起步**：0.5GB 对个人使用初期足够

## 为什么不选 D1

- Cloudflare 专有，供应商锁定风险高
- SQLite 语法与 PG 不同，迁移成本大
- Vectorize 较新，生产成熟度不如 pgvector

## 代价

- 需要学习 SQL + ORM 概念（Drizzle 降低了这个门槛）
- 跨云（Cloudflare → Neon）增加网络延迟，但 HTTP/2 多路复用缓解。**本地开发从中国直连 Neon 延迟更高（200–350ms），见 [性能诊断](../dev-log/2026-06-16-perf-neon-latency.md)**
