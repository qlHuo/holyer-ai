/// <reference types="node" />

/**
 * 回填脚本 — 为存量 chunks 补 content_tokens（全文检索的分词列）
 *
 * 跑法（在项目根目录）：
 *   npx tsx scripts/backfill-tokens.ts            # 增量：只处理 content_tokens IS NULL 的行（幂等）
 *   npx tsx scripts/backfill-tokens.ts --force    # 全量重算（改分词器/停用词表后必须用它）
 *
 * 3.9 混合检索引入 content_tokens 列后，历史 chunks 该列为 NULL（生成列 content_tsv 也随之空）。
 * 本脚本**只重新分词、绝不重新 embedding** —— 与 ingest-docs.ts 的破坏性全量重灌完全隔离。
 * content_tsv 是生成列，UPDATE content_tokens 时 PostgreSQL 会自动重算，无需单独写。
 */

import postgres from 'postgres'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import { neon } from '@neondatabase/serverless'
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http'
import { sql } from 'drizzle-orm'
import type { DbClient } from '../server/db'
import * as schema from '../server/db/schema'
import { toIndexedText, TOKENIZER_VERSION } from '../server/service/rag/tokenizer'

// 加载 .env 到 process.env（Node 20.12+ 内置，需在项目根目录运行）
process.loadEnvFile('.env')

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`❌ 缺少环境变量 ${name}`)
  return value
}

const DB_URL = requireEnv('NUXT_DATABASE_URL')

/** 全量重算：忽略 NULL 游标 */
const FORCE = process.argv.includes('--force')
/** 每批处理行数：批量 UPDATE 控制往返次数（Neon 下每次查询 = 1 subrequest） */
const BATCH = 200

/** 双驱动返回形状归一（postgres-js 返回行数组，neon-http 返回 { rows }） */
function extractRows<T>(result: unknown): T[] {
  const maybe = result as { rows?: unknown }
  return (Array.isArray(maybe.rows) ? maybe.rows : result) as T[]
}

/** 覆盖率体检：总数 / 待回填数 */
async function coverage(db: DbClient): Promise<{ total: number, pending: number }> {
  const res = await db.execute(sql`
    SELECT count(*) AS total, count(*) FILTER (WHERE content_tokens IS NULL) AS pending FROM chunks
  `)
  const [row] = extractRows<{ total: number | string, pending: number | string }>(res)
  return { total: Number(row?.total ?? 0), pending: Number(row?.pending ?? 0) }
}

/** 取一批待处理行（keyset 分页：按 id 递增，避免 OFFSET 的线性开销） */
async function fetchBatch(db: DbClient, lastId: string | null): Promise<{ id: string, content: string }[]> {
  const cond = FORCE ? sql`TRUE` : sql`content_tokens IS NULL`
  const after = lastId ? sql`AND id > ${lastId}::uuid` : sql``
  const res = await db.execute(sql`
    SELECT id, content FROM chunks WHERE ${cond} ${after} ORDER BY id LIMIT ${BATCH}
  `)
  return extractRows<{ id: string, content: string }>(res)
}

/** 一条语句批量回写（VALUES + JOIN），避免逐行 UPDATE */
async function applyBatch(db: DbClient, rows: { id: string, tokens: string }[]): Promise<void> {
  const values = sql.join(
    rows.map(r => sql`(${r.id}::uuid, ${r.tokens}::text)`),
    sql`, `
  )
  await db.execute(sql`
    UPDATE chunks SET content_tokens = v.tokens
    FROM (VALUES ${values}) AS v(id, tokens)
    WHERE chunks.id = v.id
  `)
}

async function main() {
  // 建连接 —— 按目标库选驱动（Neon 走 HTTP，本地 Docker 走 TCP）
  const isNeon = DB_URL.includes('neon.tech')
  let db: DbClient
  let closeConnection: (() => Promise<void>) | undefined

  if (isNeon) {
    db = drizzleNeon(neon(DB_URL), { schema })
  } else {
    const pool = postgres(DB_URL, { max: 10 })
    db = drizzlePostgres(pool, { schema })
    closeConnection = () => pool.end()
  }

  console.log(`分词器版本：${TOKENIZER_VERSION}｜模式：${FORCE ? '全量重算(--force)' : '增量(仅 NULL)'}｜批量：${BATCH}`)

  const before = await coverage(db)
  console.log(`回填前：总计 ${before.total} chunk，待处理 ${before.pending}\n`)

  let lastId: string | null = null
  let processed = 0
  let sampleShown = false

  for (;;) {
    const rows = await fetchBatch(db, lastId)
    if (rows.length === 0) break

    if (!sampleShown) {
      const sample = rows[0]!
      console.log(`分词抽样：[${sample.content.slice(0, 40).replace(/\n/g, ' ')}…]`)
      console.log(`         → "${toIndexedText(sample.content).slice(0, 80)}…"\n`)
      sampleShown = true
    }

    await applyBatch(db, rows.map(r => ({ id: r.id, tokens: toIndexedText(r.content) })))
    processed += rows.length
    lastId = rows[rows.length - 1]!.id
    console.log(`  已处理 ${processed} 条…`)
  }

  const after = await coverage(db)
  console.log(`\n回填完成：本次处理 ${processed} 条，剩余待处理 ${after.pending} 条`)

  if (closeConnection) await closeConnection()

  if (after.pending > 0) {
    console.error(`❌ 仍有 ${after.pending} 条未回填，请重跑本脚本`)
    process.exit(1)
  }
  console.log('✅ 覆盖率 100%')
}

main().catch((err) => {
  console.error('❌ 回填失败：', err)
  process.exit(1)
})
