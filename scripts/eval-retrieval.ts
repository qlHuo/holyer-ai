/// <reference types="node" />

/**
 * 召回验证 — 测 RAG 检索质量
 *
 * 跑法（在项目根目录）：
 *   npx tsx scripts/eval-retrieval.ts [vector|keyword|hybrid]   # 默认 hybrid
 *
 * 两组用例：
 * - conceptCases：概念理解类（语义召回为主 —— 向量路强项，混合检索不该让它回退）
 * - exactCases：精确术语类（代码标识符/专有名词 —— 全文路的靶子；mustInclude 断言字面量出现在结果里）
 *
 * 指标：文档命中率 @K、字面量命中率 @K、MRR（首个文档命中项的 1/rank，对排名改善比 0/1 命中率更敏感）。
 * 规则判定，不需要 LLM 裁判。
 */

import postgres from 'postgres'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import { neon } from '@neondatabase/serverless'
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http'
import { sql } from 'drizzle-orm'
import type { DbClient } from '../server/db'
import * as schema from '../server/db/schema'
import { embedText } from '../server/service/rag/embeddings'
import { searchByVector, searchByKeyword, hybridSearch } from '../server/service/rag/retriever'
import type { SearchResult } from '../server/service/rag/retriever'

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

type Mode = 'vector' | 'keyword' | 'hybrid'
const MODES: Mode[] = ['vector', 'keyword', 'hybrid']
const argMode = process.argv[2] ?? 'hybrid'
if (!MODES.includes(argMode as Mode)) {
  console.error(`❌ 未知模式 "${argMode}"，可选：${MODES.join(' | ')}`)
  process.exit(1)
}
const MODE = argMode as Mode

interface EvalCase {
  question: string
  /** 期望命中的 documentTitle 关键字，命中任意一个即算「文档命中」 */
  expected: string[]
  /** 精确字面量：结果 content 中须出现该字符串（精确词用例用） */
  mustInclude?: string
}

/** 概念理解类（阶段 A 的 12 题，一字不改以保住 92% 基线可比） */
const conceptCases: EvalCase[] = [
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

/**
 * 精确术语类（3.9 新增）—— 词面命中为主，是全文路相对向量路的靶子。
 * expected 的文档标题均已核对存在于语料；mustInclude 字面量在库中有区分度（非随处可见的通用词）。
 */
const exactCases: EvalCase[] = [
  { question: 'drizzle-orm/neon-http 和 postgres-js 有什么区别？', expected: ['neon-rag-deployment', 'neon-drizzle', 'drizzle-orm'], mustInclude: 'neon-http' },
  { question: 'drizzle-kit generate 和 push 有什么区别？', expected: ['drizzle-kit'], mustInclude: 'drizzle-kit' },
  { question: 'useRuntimeConfig 是怎么读取环境变量的？', expected: ['scaffold-guide', 'extensibility', 'nuxt4-notes'], mustInclude: 'useRuntimeConfig' },
  { question: 'HNSW 和暴力检索该怎么选？', expected: ['pgvector', 'rag-knowledge-base-design'], mustInclude: 'HNSW' },
  { question: 'contextual_text 这一列是给哪个阶段预留的？', expected: ['rag-schema', 'rag-knowledge-base-design'], mustInclude: 'contextual_text' },
  { question: '为什么用 Matryoshka 表示学习可以降低维度？', expected: ['embedding-dimensions'], mustInclude: 'Matryoshka' },
  { question: 'maxToolCalls 预算超了会怎样？', expected: ['agent-tool-budget'], mustInclude: 'maxToolCalls' },
  { question: 'allowedImages 白名单是怎么收集的？', expected: ['rag-image-display-boundary', 'rag-knowledge-base-design'], mustInclude: 'allowedImages' },
  { question: 'Too many subrequests 的根因是什么？', expected: ['cf-workers-subrequest-limit'], mustInclude: 'subrequest' }
]

interface GroupStat {
  label: string
  total: number
  docHit: number
  literalHit: number
  literalTotal: number
  mrrSum: number
}

function newStat(label: string): GroupStat {
  return { label, total: 0, docHit: 0, literalHit: 0, literalTotal: 0, mrrSum: 0 }
}

/**
 * 引用溯源（3.11）字段的运行时可观测计数
 *
 * retriever 的两条 raw SQL 是手写列名，新增列没有类型安全兜底 —— 拼错列名只有运行时才炸。
 * heading_path 是 jsonb、经 `::text` 取出后 JSON.parse，两个驱动（postgres-js / neon-http）
 * 的返回形状差异也只能靠实跑发现。所以这里做一次真实断言：库覆盖率 100% 时，
 * **检索结果里不该再出现 null 的 headingPath**；出现即说明加列/解析链路断了。
 */
let resultTotal = 0
let headingNullInResults = 0

/** 执行检索（vector/hybrid 需先算查询向量；keyword 不需要 embedding） */
async function runSearch(
  db: DbClient,
  question: string,
  config: { embeddingApiKey: string, embeddingBaseUrl: string }
): Promise<SearchResult[]> {
  if (MODE === 'keyword') return searchByKeyword(db, question, { topK: TOP_K })
  const vec = await embedText(question, config)
  if (MODE === 'vector') return searchByVector(db, vec, { topK: TOP_K })
  return hybridSearch(db, vec, question, { topK: TOP_K })
}

async function runGroup(
  db: DbClient,
  stat: GroupStat,
  cases: EvalCase[],
  config: { embeddingApiKey: string, embeddingBaseUrl: string }
) {
  for (const c of cases) {
    stat.total++
    const results = await runSearch(db, c.question, config)

    // 引用溯源字段断言（见文件头的计数说明）
    for (const r of results) {
      resultTotal++
      if (r.headingPath === null) headingNullInResults++
    }

    // 文档命中 + MRR（首个命中项的名次）
    const hitIdx = results.findIndex(r => c.expected.some(k => r.documentTitle.includes(k)))
    if (hitIdx >= 0) {
      stat.docHit++
      stat.mrrSum += 1 / (hitIdx + 1)
    }

    // 字面量命中（精确词用例）
    const literalOk = c.mustInclude
      ? results.some(r => r.content.includes(c.mustInclude!))
      : undefined
    if (literalOk !== undefined) {
      stat.literalTotal++
      if (literalOk) stat.literalHit++
    }

    if (hitIdx >= 0) {
      const marks = [`#${hitIdx + 1} ${results[hitIdx]!.documentTitle}`]
      if (literalOk === true) marks.push(`含「${c.mustInclude}」`)
      else if (literalOk === false) marks.push(`⚠️ 无「${c.mustInclude}」`)
      console.log(`✅ ${c.question}\n   → ${marks.join('｜')}`)
    } else {
      console.log(`❌ ${c.question}`)
      console.log(`   期望：${c.expected.join(' / ')}`)
      console.log(`   实际 top-${TOP_K}：`)
      results.forEach((r, i) => console.log(`     ${i + 1}. [${r.source}] ${r.documentTitle}`))
    }
  }
}

function summaryLine(stat: GroupStat): string {
  const docRate = stat.total ? Math.round(stat.docHit / stat.total * 100) : 0
  const mrr = stat.total ? (stat.mrrSum / stat.total).toFixed(3) : '0.000'
  const literal = stat.literalTotal
    ? `, 字面量 ${stat.literalHit}/${stat.literalTotal} (${Math.round(stat.literalHit / stat.literalTotal * 100)}%)`
    : ''
  return `${stat.docHit}/${stat.total} (${docRate}%)${literal}｜MRR ${mrr}`
}

async function main() {
  // 建连接 —— 按目标库选驱动（Neon 走 HTTP，本地 Docker 走 TCP）。
  // 两个驱动都跑一遍本脚本，才能同时验证 retriever 的两条 raw SQL 在两种返回形状下都正确。
  const isNeon = DB_URL.includes('neon.tech')
  let db: DbClient
  let pool: ReturnType<typeof postgres> | undefined

  if (isNeon) {
    db = drizzleNeon(neon(DB_URL), { schema })
  } else {
    pool = postgres(DB_URL, { max: 10 })
    db = drizzlePostgres(pool, { schema })
  }

  const config = { embeddingApiKey: EMBEDDING_API_KEY, embeddingBaseUrl: EMBEDDING_BASE_URL }

  // 分词覆盖率（keyword/hybrid 依赖 content_tokens；缺列会导致全文路静默漏召）
  // 顺带体检 heading_path 回填覆盖率（3.11；未回填时来源列表只能显示标题）
  const cov = await db.execute(sql`
    SELECT count(*) AS total,
           count(*) FILTER (WHERE content_tokens IS NULL) AS pending,
           count(*) FILTER (WHERE heading_path IS NULL) AS heading_pending
    FROM chunks
  `)
  const covRow = (('rows' in cov ? cov.rows : cov) as unknown as {
    total: number | string
    pending: number | string
    heading_pending: number | string
  }[])[0]
  const total = Number(covRow?.total ?? 0)
  const pending = Number(covRow?.pending ?? 0)
  const headingPending = Number(covRow?.heading_pending ?? 0)

  console.log(`驱动：${isNeon ? 'neon-http' : 'postgres-js'}｜模式：${MODE}｜top-K：${TOP_K}`)
  console.log(`用例：concept ${conceptCases.length} / exact ${exactCases.length}｜分词覆盖：${total - pending}/${total}${pending ? ' ⚠️ 有未回填行' : ''}｜标题路径覆盖：${total - headingPending}/${total}${headingPending ? ' ⚠️ 待回填' : ''}\n`)

  console.log('—— conceptCases ——')
  const concept = newStat('concept')
  await runGroup(db, concept, conceptCases, config)

  console.log('\n—— exactCases ——')
  const exact = newStat('exact')
  await runGroup(db, exact, exactCases, config)

  console.log(`\n========== 汇总（${MODE}）==========`)
  console.log(`concept：${summaryLine(concept)}`)
  console.log(`exact  ：${summaryLine(exact)}`)

  if (pool) await pool.end()

  // 引用溯源字段断言（见文件头）：库里有值、检索结果却全是 null → 说明加列或解析链路断了
  if (headingPending === 0 && headingNullInResults > 0) {
    console.error(`\n❌ heading_path 断言失败：库覆盖率 100%，但 ${headingNullInResults}/${resultTotal} 条检索结果 headingPath 为 null`)
    console.error('   检查 retriever 两条 SQL 的 c.heading_path::text、RawRow 列名、parseHeadingPath 解析')
    process.exit(1)
  }
  console.log(`\nheading_path 断言：${resultTotal - headingNullInResults}/${resultTotal} 条检索结果带标题路径`)
}

main().catch((err) => {
  console.error('❌ 评估失败：', err)
  process.exit(1)
})
