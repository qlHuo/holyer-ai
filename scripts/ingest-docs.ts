/// <reference types="node" />

/**
 * 灌库脚本 — 读 docs/ + .claude/plan/ 的 markdown → 分块 → 向量化 → 存库
 *
 * 跑法（在项目根目录）：
 *   1. 首次：pnpm add -D tsx
 *   2. 执行：npx tsx scripts/ingest-docs.ts
 *
 * 作用：阶段 A 验证检索质量的灌库入口。阶段 B 的 POST /api/rag/documents 复用同一套
 * chunker/embeddings service，本脚本保留作批量导入调试工具。
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import postgres from 'postgres'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import { neon } from '@neondatabase/serverless'
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http'
import type { DbClient } from '../server/db'
import * as schema from '../server/db/schema'
import { ingestDocument } from '../server/service/rag/ingest'

// 1. 加载 .env 到 process.env（Node 20.12+ 内置，需在项目根目录运行）
process.loadEnvFile('.env')

// 读取并校验环境变量，缺失直接抛错（throw 能被 TS 识别为「永不返回」，从而收窄类型）
function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`❌ 缺少环境变量 ${name}`)
  return value
}

const DB_URL = requireEnv('NUXT_DATABASE_URL')
const EMBEDDING_API_KEY = requireEnv('NUXT_EMBEDDING_API_KEY')
const EMBEDDING_BASE_URL = requireEnv('NUXT_EMBEDDING_BASE_URL')

// 数据源：目录 + 标题前缀（前缀区分来源，便于引用溯源）
const SOURCES = [
  { dir: 'docs', titlePrefix: '' },
  { dir: '.claude/plan', titlePrefix: 'plan/' }
]

async function main() {
  // 2. 建连接 —— 按目标库选驱动：
  //    Neon 走 HTTP（neon-http，端口 443，和生产运行时同源；postgres-js 的 TCP 5432 会 ECONNRESET）
  //    本地 Docker 走 TCP（postgres-js，Docker 无 HTTP 端点）
  const isNeon = DB_URL.includes('neon.tech')
  let db: DbClient
  let closeConnection: (() => Promise<void>) | undefined

  if (isNeon) {
    db = drizzleNeon(neon(DB_URL), { schema })
  } else {
    const sql = postgres(DB_URL, { max: 10 })
    db = drizzlePostgres(sql, { schema })
    closeConnection = () => sql.end()
  }

  // 3. 清空旧数据（子表在前），保证脚本可重复运行
  await db.delete(schema.chunks)
  await db.delete(schema.documents)
  await db.delete(schema.knowledgeBases)

  // 4. 建一个知识库
  const [kb] = await db.insert(schema.knowledgeBases).values({
    name: '项目文档',
    description: 'docs/ + .claude/plan/ 目录下的项目文档'
  }).returning()

  // 5. 收集所有源目录下的 markdown（跳过 INDEX 索引）
  const files: { path: string, title: string }[] = []
  for (const source of SOURCES) {
    const entries = (await readdir(source.dir, { recursive: true }))
      .filter(f => f.endsWith('.md'))
      .filter(f => !f.endsWith('INDEX.md'))
    for (const f of entries) {
      files.push({
        path: join(source.dir, f),
        title: `${source.titlePrefix}${f.replace(/\.md$/, '')}`
      })
    }
  }

  const config = { embeddingApiKey: EMBEDDING_API_KEY, embeddingBaseUrl: EMBEDDING_BASE_URL }
  let totalChunks = 0

  for (const { path, title } of files) {
    const content = await readFile(path, 'utf-8')

    // 5. 复用统一的入库 service（分块/向量化/多行写库/失败回滚），见 server/service/rag/ingest.ts
    const { chunkCount } = await ingestDocument(db, config, {
      kbId: kb.id,
      title,
      content
    })

    totalChunks += chunkCount
    console.log(`✅ ${title}：${chunkCount} 个 chunk`)
  }

  console.log(`\n🎉 完成：${files.length} 篇文档 → ${totalChunks} 个 chunk`)
  if (closeConnection) await closeConnection()
}

main().catch((err) => {
  console.error('❌ 灌库失败：', err)
  process.exit(1)
})
