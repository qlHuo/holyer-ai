/// <reference types="node" />

/**
 * 召回验证 — 用 N 个问题测 RAG 检索质量（阶段 A 卡点：命中率 >80% 才进阶段 B）
 *
 * 跑法（在项目根目录）：
 *   npx tsx scripts/eval-retrieval.ts
 *
 * 方法：每个问题配「期望命中的文档」（ground truth），检索 top-K，
 * 看期望文档是否在结果里（documentTitle 包含关键字）。规则判定，不需要 LLM 裁判。
 */

import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from '../server/db/schema'
import { embedText } from '../server/service/rag/embeddings'
import { searchChunks } from '../server/service/rag/retriever'

process.loadEnvFile('.env')

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`缺少环境变量 ${name}`)
  return value
}

const DB_URL = requireEnv('NUXT_DATABASE_URL')
const EMBEDDING_API_KEY = requireEnv('NUXT_EMBEDDING_API_KEY')
const EMBEDDING_BASE_URL = requireEnv('NUXT_EMBEDDING_BASE_URL')

const TOP_K = 5

interface EvalCase {
  question: string
  expected: string[] // 期望命中的 documentTitle 关键字，命中任意一个即算命中
}

const cases: EvalCase[] = [
  { question: '为什么项目选择 Neon 数据库而不是 Supabase？', expected: ['neon-drizzle'] },
  { question: '为什么不用 Vercel AI SDK？', expected: ['vercel-ai-sdk'] },
  { question: '国内模型 API 是怎么统一兼容的？', expected: ['model-compatibility'] },
  { question: 'Cloudflare 的 SSE 为什么需要心跳机制？', expected: ['sse-implementation'] },
  { question: '流式串话的根因是什么？', expected: ['stream-leakage-root-cause'] },
  { question: 'pgvector 为什么几百个 chunk 不需要建索引？', expected: ['pgvector'] },
  { question: 'embedding 维度为什么锁定 1024？', expected: ['embedding-dimensions'] },
  { question: 'Drizzle 的 returning 有什么用？', expected: ['drizzle-orm'] },
  { question: 'Agent 工具调用的文本闪烁怎么解决？', expected: ['agent-react-known-issues'] },
  { question: 'RAG 为什么按 Markdown 标题语义分块？', expected: ['rag-knowledge-base-design'] },
  { question: '说明项目整体的流程，包括前后端、数据库、部署', expected: ['plan/architecture'] },
  { question: '说明流式输出的方案', expected: ['streaming-architecture', 'sse-implementation'] }
]

async function main() {
  const sql = postgres(DB_URL, { max: 10 })
  const db = drizzle(sql, { schema })
  const config = { embeddingApiKey: EMBEDDING_API_KEY, embeddingBaseUrl: EMBEDDING_BASE_URL }

  let pass = 0
  const failures: { question: string, expected: string[], got: string[] }[] = []

  console.log(`问题数：${cases.length} | top-K：${TOP_K}\n`)

  for (const c of cases) {
    const vec = await embedText(c.question, config)
    const results = await searchChunks(db, vec, { topK: TOP_K })
    const titles = results.map(r => r.documentTitle)

    const hit = c.expected.some(k => titles.some(t => t.includes(k)))

    if (hit) {
      pass++
      const matched = titles.find(t => c.expected.some(k => t.includes(k)))
      console.log(`✅ ${c.question}\n   → 命中 ${matched}`)
    } else {
      failures.push({ question: c.question, expected: c.expected, got: titles })
      console.log(`❌ ${c.question}`)
      console.log(`   期望命中：${c.expected.join(' / ')}`)
      console.log(`   实际 top-${TOP_K}：`)
      results.forEach((r, i) => console.log(`     ${i + 1}. [${r.score.toFixed(3)}] ${r.documentTitle}`))
    }
  }

  const rate = Number((pass / cases.length * 100).toFixed(0))
  const passLine = rate >= 80 ? ' ✅ 达标（≥80%）' : ' ❌ 未达标（<80%，需调分块/检索策略）'
  console.log(`\n========== 汇总 ==========`)
  console.log(`命中 ${pass}/${cases.length}（${rate}%）${passLine}`)

  await sql.end()
}

main().catch((err) => {
  console.error('❌ 评估失败：', err)
  process.exit(1)
})
