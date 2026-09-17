/// <reference types="node" />

/**
 * 回填脚本 — 为存量 chunks 补 heading_path（引用溯源 3.11 的结构化标题路径）
 *
 * 跑法（在项目根目录）：
 *   npx tsx scripts/backfill-heading-path.ts            # 增量：只处理 heading_path IS NULL 的行（幂等）
 *   npx tsx scripts/backfill-heading-path.ts --force    # 全量重算（改分块逻辑后用它）
 *
 * ## 为什么是「重新分块」而不是「从 content 前缀反推」
 *
 * chunker 早就提取了 headingPath，但 ingest 只把它 `join(' > ')` 拼进 content 前缀就丢弃了
 * （见 server/service/rag/ingest.ts）。理论上可以从前缀 split 回来，但正文首行恰好长成
 * 那个形状就会误判 —— 靠启发式解析数据不如重新算一遍确定。
 *
 * 重算是**精确且便宜**的：parseMarkdown + chunkSections 全是纯函数、无时间/随机/IO，
 * chunker.ts 自创建以来只有一次提交、DEFAULT_OPTIONS 未变，且 chunkIndex 是全文全局递增，
 * 所以「重算结果的第 k 项」必然对应「库中 chunk_index = k 的那一行」。
 * **只重新分块，绝不重新 embedding** —— 与 ingest-docs.ts 的破坏性全量重灌完全隔离。
 *
 * ## 一致性校验（安全网）
 *
 * 逐 chunk 用「重算出的 headingPath + 原文」重建 content，与库中 content 逐字节比对；
 * 不一致就跳过整篇文档并告警（说明库里的数据不是这套分块逻辑产的），
 * 宁可不回填，也不写入错误的标题路径。
 */

import postgres from 'postgres'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import { neon } from '@neondatabase/serverless'
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http'
import { sql } from 'drizzle-orm'
import type { DbClient } from '../server/db'
import * as schema from '../server/db/schema'
import { parseMarkdown, chunkSections } from '../server/service/rag/chunker'

// 加载 .env 到 process.env（Node 20.12+ 内置，需在项目根目录运行）
process.loadEnvFile('.env')

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`❌ 缺少环境变量 ${name}`)
  return value
}

const DB_URL = requireEnv('NUXT_DATABASE_URL')

/** 全量重算：连已有值的行也重写 */
const FORCE = process.argv.includes('--force')
/** 每批处理文档数（Neon 下控制往返次数） */
const BATCH = 50

/** 双驱动返回形状归一（postgres-js 返回行数组，neon-http 返回 { rows }） */
function extractRows<T>(result: unknown): T[] {
  const maybe = result as { rows?: unknown }
  return (Array.isArray(maybe.rows) ? maybe.rows : result) as T[]
}

/** 覆盖率体检：总数 / 待回填数 */
async function coverage(db: DbClient): Promise<{ total: number, pending: number }> {
  const res = await db.execute(sql`
    SELECT count(*) AS total, count(*) FILTER (WHERE heading_path IS NULL) AS pending FROM chunks
  `)
  const [row] = extractRows<{ total: number | string, pending: number | string }>(res)
  return { total: Number(row?.total ?? 0), pending: Number(row?.pending ?? 0) }
}

/** 取一批文档（keyset 分页：按 id 递增，避免 OFFSET 的线性开销） */
async function fetchDocBatch(
  db: DbClient,
  lastId: string | null
): Promise<{ id: string, title: string, content: string }[]> {
  const after = lastId ? sql`AND id > ${lastId}::uuid` : sql``
  const res = await db.execute(sql`
    SELECT id, title, content FROM documents WHERE TRUE ${after} ORDER BY id LIMIT ${BATCH}
  `)
  return extractRows<{ id: string, title: string, content: string }>(res)
}

/** 某文档的切片（按 chunk_index 升序；pending 用于增量模式跳过已有值的行） */
async function fetchChunks(
  db: DbClient,
  docId: string
): Promise<{ id: string, chunk_index: number, content: string, pending: boolean }[]> {
  const res = await db.execute(sql`
    SELECT id, chunk_index, content, (heading_path IS NULL) AS pending
    FROM chunks WHERE doc_id = ${docId}::uuid ORDER BY chunk_index
  `)
  return extractRows<{ id: string, chunk_index: number, content: string, pending: boolean }>(res)
}

/** 一条语句批量回写（VALUES + JOIN），避免逐行 UPDATE */
async function applyBatch(db: DbClient, rows: { id: string, path: string }[]): Promise<void> {
  if (rows.length === 0) return
  const values = sql.join(
    rows.map(r => sql`(${r.id}::uuid, ${r.path}::jsonb)`),
    sql`, `
  )
  await db.execute(sql`
    UPDATE chunks SET heading_path = v.path
    FROM (VALUES ${values}) AS v(id, path)
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

  console.log(`目标库：${isNeon ? 'Neon (neon-http)' : '本地 (postgres-js)'}｜模式：${FORCE ? '全量重算(--force)' : '增量(仅 NULL)'}`)

  const before = await coverage(db)
  console.log(`回填前：总计 ${before.total} chunk，待处理 ${before.pending}\n`)

  let lastId: string | null = null
  let docCount = 0
  let updated = 0
  const skippedDocs: string[] = []

  for (;;) {
    const docs = await fetchDocBatch(db, lastId)
    if (docs.length === 0) break

    for (const doc of docs) {
      docCount++
      const chunks = await fetchChunks(db, doc.id)
      if (chunks.length === 0) continue // 空文档（入库失败残留）跳过

      const recomputed = chunkSections(parseMarkdown(doc.content))

      // 一致性校验：数量 + 逐字节 content 比对
      let mismatchReason: string | null = null
      if (recomputed.length !== chunks.length) {
        mismatchReason = `切片数不符（库 ${chunks.length} / 重算 ${recomputed.length}）`
      } else {
        for (const c of chunks) {
          const r = recomputed[c.chunk_index]
          if (!r) {
            mismatchReason = `缺少 chunk_index=${c.chunk_index}`
            break
          }
          const expected = r.headingPath.length
            ? `${r.headingPath.join(' > ')}\n${r.content}`
            : r.content
          if (expected !== c.content) {
            mismatchReason = `content 不符（chunk_index=${c.chunk_index}）`
            break
          }
        }
      }

      if (mismatchReason) {
        // 库中数据不是这套分块逻辑产的 → 宁可不填，也不写错误的标题路径
        skippedDocs.push(`${doc.title}（${mismatchReason}）`)
        continue
      }

      const targets = FORCE ? chunks : chunks.filter(c => c.pending)
      await applyBatch(db, targets.map((c) => {
        const r = recomputed[c.chunk_index]!
        return { id: c.id, path: JSON.stringify(r.headingPath) }
      }))
      updated += targets.length
    }

    lastId = docs[docs.length - 1]!.id
    console.log(`  已扫描 ${docCount} 篇文档，回填 ${updated} 条…`)
  }

  const after = await coverage(db)
  console.log(`\n回填完成：扫描 ${docCount} 篇文档，本次回填 ${updated} 条，剩余待处理 ${after.pending} 条`)

  if (skippedDocs.length > 0) {
    console.warn(`\n⚠️ 跳过 ${skippedDocs.length} 篇（无法与现有分块对齐，未写入）：`)
    for (const s of skippedDocs.slice(0, 20)) console.warn(`   - ${s}`)
    if (skippedDocs.length > 20) console.warn(`   … 另有 ${skippedDocs.length - 20} 篇`)
  }

  if (closeConnection) await closeConnection()

  if (after.pending > 0) {
    console.error(`\n❌ 仍有 ${after.pending} 条未回填，请重跑本脚本（若持续不动，看上面的跳过清单）`)
    process.exit(1)
  }
  console.log('✅ 覆盖率 100%')
}

main().catch((err) => {
  console.error('❌ 回填失败：', err)
  process.exit(1)
})
