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
import { parseMarkdown, chunkSections } from '../server/service/rag/chunker'
import { embedTexts, EMBEDDING_MODEL } from '../server/service/rag/embeddings'

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
const BATCH_SIZE = 20 // 每批向量化的 chunk 数（减少 API 调用次数）

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

    // 5a. 存文档（原文 content 支持下载）
    const [doc] = await db.insert(schema.documents).values({
      kbId: kb.id,
      title,
      content
    }).returning()

    // 5b. 分块，并把标题路径拼进 content（决策 1「标题 → content」：让 chunk 自包含、更好召回）
    const sections = parseMarkdown(content)
    const chunks = chunkSections(sections).map(c => ({
      ...c,
      content: c.headingPath.length
        ? `${c.headingPath.join(' > ')}\n${c.content}`
        : c.content
    }))

    // 5c. 批量向量化（每批 BATCH_SIZE 条）
    const vectors: number[][] = []
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE)
      vectors.push(...await embedTexts(batch.map(c => c.content), config))
    }

    // 5d. 存切片（content + 向量 + 元数据）
    for (let i = 0; i < chunks.length; i++) {
      await db.insert(schema.chunks).values({
        docId: doc.id,
        kbId: kb.id,
        chunkIndex: chunks[i].chunkIndex,
        content: chunks[i].content,
        embedding: vectors[i],
        embeddingModel: EMBEDDING_MODEL
      })
    }

    totalChunks += chunks.length
    console.log(`✅ ${title}：${chunks.length} 个 chunk`)
  }

  console.log(`\n🎉 完成：${files.length} 篇文档 → ${totalChunks} 个 chunk`)
  if (closeConnection) await closeConnection()
}

main().catch((err) => {
  console.error('❌ 灌库失败：', err)
  process.exit(1)
})
