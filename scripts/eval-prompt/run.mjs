/**
 * Prompt 评测运行器 — 快照版
 *
 * 跑法（Node 22，零依赖）：
 *   node --env-file=.env scripts/eval-prompt/run.mjs
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
 * ⚠️ 注意：本文件是「快照」，system prompt 与工具定义复制自
 *   server/api/chat/index.post.ts（dateContext + toolUsageGuidelines）
 *   和 server/service/agent/tools/builtin/*.ts。
 *   若线上改了这些文件，需要同步本快照，否则测的不是真实 prompt。
 */

import { cases } from './cases.mjs'

const BASE_URL = (process.env.NUXT_MODEL_BASE_URL || '').replace(/\/+$/, '')
const API_KEY = process.env.NUXT_MODEL_API_KEY || ''
const MODEL = process.env.EVAL_MODEL || 'deepseek-v4-pro'
const TEMPERATURE = process.env.EVAL_TEMPERATURE !== undefined ? Number(process.env.EVAL_TEMPERATURE) : 0

// ────────────────────────────────────────────────────────────
// 快照 1：system prompt（对应 index.post.ts 的 dateContext + toolUsageGuidelines）
// ────────────────────────────────────────────────────────────
function buildSystemPrompt() {
  const now = new Date()
  const dateContext = `## 当前时间
今天是 ${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日（周${['日', '一', '二', '三', '四', '五', '六'][now.getDay()]}），当前时间是 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}（北京时间 UTC+8）。
搜索实时信息时，请使用上述日期作为参考，不要使用过期的年份。`

  const toolUsageGuidelines = `## 工具调用准则
你可以使用工具来辅助回答问题。按以下规则选择是否调用及调用哪个工具：
- 涉及实时信息、最新资讯、事实核查 → 调用 web_search
- 需要读取某个具体网页的内容 → 调用 web_fetch（需提供完整 URL）
- 涉及多位数字的算术运算 → 调用 calculator
- 询问当前日期或时间 → 调用 current_time
- 日常问候、闲聊、常识性问题 → 不要调用工具，直接回答
- 用户明确要求「查询 / 搜索 / 查一下 / 最新」等信息时，应调用 web_search 获取最新结果，不要仅凭记忆回答`

  return `${dateContext}\n\n${toolUsageGuidelines}`
}

// ────────────────────────────────────────────────────────────
// 快照 2：4 个工具定义（对应 tools/builtin/*.ts 的 toDefinition()）
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
      name: 'current_time',
      description: '获取当前日期和时间。可指定 IANA 时区（如 Asia/Shanghai、America/New_York）。',
      parameters: {
        type: 'object',
        properties: {
          timezone: { type: 'string', description: 'IANA 时区标识符，例如 "Asia/Shanghai"、"America/New_York"、"Europe/London"。不传则返回北京时间（UTC+8）。' }
        },
        required: []
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

// ────────────────────────────────────────────────────────────
// 调用 LLM（OpenAI 兼容，非流式）
// ────────────────────────────────────────────────────────────
async function ask(userMessage) {
  const body = {
    model: MODEL,
    stream: false,
    temperature: TEMPERATURE,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
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
          { role: 'system', content: buildSystemPrompt() },
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
