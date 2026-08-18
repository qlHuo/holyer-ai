/**
 * Prompt 评测集 — 快照版
 *
 * 每条 case 只声明「期望行为」，由 run.mjs 自动判定，无需人工看结果：
 * - expectedTool: 期望调用的工具名；null 表示期望不调用工具（直接回答）
 * - expectedArgs:  期望参数里必须包含的字符串（做包含判断，不做全等）
 *
 * 如何扩展：复制一行，改 id / userMessage / expectedTool 即可。
 * 重点覆盖「容易选错工具」的模糊提问，而不是只有标准 happy path。
 */

export const cases = [
  // ── 负例：期望不调工具，直接回答 ──
  { id: 'greet', userMessage: '你好', expectedTool: null },
  { id: 'joke', userMessage: '给我讲个冷笑话', expectedTool: null },
  // 时间问题：dateContext 已注入当前时间，期望直接回答而非调工具
  { id: 'time-a', userMessage: '现在几点了', expectedTool: null },
  { id: 'time-b', userMessage: '今天星期几', expectedTool: null },

  // ── calculator ──
  { id: 'calc-a', userMessage: '帮我算 12345 * 6789 等于多少', expectedTool: 'calculator', expectedArgs: { expression: '12345' } },
  { id: 'calc-b', userMessage: '帮我算 98765.4321 乘以 12345.6789 等于多少', expectedTool: 'calculator', expectedArgs: { expression: '98765' } },

  // ── web_search ──
  { id: 'search-a', userMessage: 'TypeScript 5.8 有哪些新特性', expectedTool: 'web_search' },
  { id: 'search-b', userMessage: '2026 年诺贝尔物理学奖得主是谁', expectedTool: 'web_search' },

  // ── web_fetch（带明确 URL） ──
  { id: 'fetch-a', userMessage: '打开 https://zh.wikipedia.org/wiki/TypeScript 看下内容', expectedTool: 'web_fetch', expectedArgs: { url: 'zh.wikipedia.org' } },

  // ── 模糊 case：有主题但无 URL，期望走搜索而非抓取（验证 web_search / web_fetch 边界） ──
  { id: 'ambiguous', userMessage: '查一下 Vue 3 ref 的用法', expectedTool: 'web_search' }
]
