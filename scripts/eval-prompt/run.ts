/**
 * Prompt 评测运行器 — 快照版
 *
 * 跑法（Node 22 + tsx）：
 *   npx tsx --env-file=.env scripts/eval-prompt/run.ts
 *
 * 可选环境变量：
 *   EVAL_MODEL        要测的模型 ID（默认 deepseek-v4-pro）
 *   EVAL_TEMPERATURE  温度（默认 0，低温让结果可复现；线上默认温度不同，结论代表「模型最确定的选择」）
 *   DRY_RUN=1         只打印第一个 case 的完整请求体（不发请求），用于核对快照 prompt 与线上一致
 *
 * 依赖的环境变量（来自 .env，与 nuxt runtimeConfig 同名）：
 *   NUXT_MODEL_BASE_URL   OpenAI 兼容接口地址
 *   NUXT_MODEL_API_KEY    API Key
 *
 * ⚠️ 注意：system prompt 直接复用 server/service/system-prompt/（不再复制），
 *   只有工具定义仍是快照（复制自 server/service/agent/tools/builtin/*.ts）。
 *   若内置工具定义变化，需要同步本文件的 TOOLS，否则测的不是真实工具集。
 */
import { cases } from './cases.mjs'
import { buildSystemPrompt } from '../../server/service/system-prompt'

const BASE_URL = (process.env.NUXT_MODEL_BASE_URL || '').replace(/\/+$/, '')
const API_KEY = process.env.NUXT_MODEL_API_KEY || ''
const MODEL = process.env.EVAL_MODEL || 'deepseek-v4-pro'
const TEMPERATURE = process.env.EVAL_TEMPERATURE !== undefined ? Number(process.env.EVAL_TEMPERATURE) : 0

// ────────────────────────────────────────────────────────────
// 快照：工具定义（对应 tools/builtin/*.ts 的 toDefinition()）
// system prompt 不在此复制，统一由 server/service/system-prompt/ 生成
// ────────────────────────────────────────────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'calculator',
      description: '执行数学计算。支持 + - * / ( ) % 运算符、小数和科学计数法（如 1e10）。输入一个数学表达式字符串，返回计算结果。',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: '要计算的数学表达式，例如 "2 + 3 * 4" 或 "(100 - 20) / 4"' }
        },
        required: ['expression']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '在互联网上搜索信息。输入搜索查询（自然语言问题或关键词均可），返回相关网页的标题、URL 和内容摘要。适用于需要实时信息、事实核查或查找资料的场景。当你不确定目标网页的具体 URL 时，先用本工具搜索定位；需要抓取某个具体 URL 时改用 web_fetch。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索查询，建议使用完整的自然语言问题以获得最佳结果。例如 "TypeScript 5.8 有哪些新特性" 或 "2026年诺贝尔物理学奖获得者"' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: '获取指定网页的文本内容。输入一个完整的 URL（需包含 https://），返回提取后的纯文本。适用于阅读文章、查看文档或获取网页信息。仅在已确定具体 URL 时使用，不要猜测或编造 URL——若只有一个主题而没有 URL，请改用 web_search。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要获取的网页完整 URL，必须以 https:// 开头。例如 "https://zh.wikipedia.org/wiki/TypeScript"' }
        },
        required: ['url']
      }
    }
  }
]

/** 用与线上相同的拼装逻辑生成 system prompt（工具名取自下面的快照） */
function buildSnapshotSystemPrompt(): string {
  return buildSystemPrompt({
    toolNames: TOOLS.map(tool => tool.function.name)
  })
}

// ────────────────────────────────────────────────────────────
// 调用 LLM（OpenAI 兼容，非流式）
// ────────────────────────────────────────────────────────────
async function ask(userMessage) {
  const body = {
    model: MODEL,
    stream: false,
    temperature: TEMPERATURE,
    messages: [
      { role: 'system', content: buildSnapshotSystemPrompt() },
      { role: 'user', content: userMessage }
    ],
    tools: TOOLS
  }

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
  }

  const data = await res.json()
  return data.choices?.[0]?.message ?? null
}

// ────────────────────────────────────────────────────────────
// 规则判定：工具名对不对、参数对不对
// ────────────────────────────────────────────────────────────
function judge(c, msg) {
  const toolCalls = msg?.tool_calls ?? []
  const tool = toolCalls[0]?.function // 只关心第一个工具调用

  // 负例：期望不调工具
  if (c.expectedTool === null) {
    if (!tool) return { ok: true, note: '未调用工具，直接回答' }
    return { ok: false, note: `误调用 ${tool.name}（期望直接回答）` }
  }

  // 正例：期望调用某工具
  if (!tool) return { ok: false, note: `未调用工具（期望 ${c.expectedTool}）` }

  if (tool.name !== c.expectedTool) {
    return { ok: false, note: `选错工具：期望 ${c.expectedTool}，实际 ${tool.name}` }
  }

  // 参数校验（若有要求）
  if (c.expectedArgs) {
    let args
    try {
      args = JSON.parse(tool.arguments)
    } catch {
      return { ok: false, note: `参数不是合法 JSON：${tool.arguments}` }
    }
    for (const [k, v] of Object.entries(c.expectedArgs)) {
      if (!String(args[k] ?? '').includes(v)) {
        return { ok: false, note: `参数 ${k} 缺少 "${v}"，实际：${JSON.stringify(args[k])}` }
      }
    }
  }

  return { ok: true, note: `${tool.name}${tool.arguments ? ` ${tool.arguments}` : ''}` }
}

// ────────────────────────────────────────────────────────────
// 主流程
// ────────────────────────────────────────────────────────────
async function main() {
  if (!BASE_URL || !API_KEY) {
    console.error('❌ 缺少环境变量 NUXT_MODEL_BASE_URL 或 NUXT_MODEL_API_KEY')
    console.error('   请确认 .env 存在，并用 node --env-file=.env 运行')
    process.exit(1)
  }

  // DRY_RUN：只打印第一个 case 的请求体，核对快照
  if (process.env.DRY_RUN) {
    console.log(JSON.stringify(
      {
        model: MODEL,
        temperature: TEMPERATURE,
        messages: [
          { role: 'system', content: buildSnapshotSystemPrompt() },
          { role: 'user', content: cases[0].userMessage }
        ],
        tools: TOOLS
      },
      null,
      2
    ))
    return
  }

  console.log(`模型：${MODEL} | 温度：${TEMPERATURE} | 用例数：${cases.length}\n`)

  // 串行跑，避免限流；case 少，总耗时可控
  let pass = 0
  const byTool = new Map() // 按期望工具统计：{ total, pass }
  const failures = []

  for (const c of cases) {
    const key = c.expectedTool ?? '(不调工具)'
    if (!byTool.has(key)) byTool.set(key, { total: 0, pass: 0 })

    try {
      const msg = await ask(c.userMessage)
      const r = judge(c, msg)
      byTool.get(key).total++
      if (r.ok) {
        pass++
        byTool.get(key).pass++
      } else {
        failures.push({ id: c.id, ...r })
      }
      console.log(`${r.ok ? '✅' : '❌'} [${c.id}] ${c.userMessage}\n   → ${r.note}`)
    } catch (e) {
      byTool.get(key).total++
      failures.push({ id: c.id, note: `请求失败：${e.message}` })
      console.log(`💥 [${c.id}] ${c.userMessage}\n   → 请求失败：${e.message}`)
    }
  }

  console.log(`\n========== 汇总 ==========`)
  console.log(`通过 ${pass}/${cases.length}（${((pass / cases.length) * 100).toFixed(0)}%）`)

  console.log(`\n按期望工具统计：`)
  for (const [tool, s] of byTool) {
    const pct = s.total ? `${((s.pass / s.total) * 100).toFixed(0)}%` : '-'
    console.log(`  ${tool}: ${s.pass}/${s.total} (${pct})`)
  }

  if (failures.length) {
    console.log(`\n失败用例：`)
    for (const f of failures) console.log(`  ❌ [${f.id}] ${f.note}`)
  }
}

main()
