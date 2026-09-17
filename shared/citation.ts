/**
 * 引用溯源（3.11）— 工具结果里的机器可读来源元数据
 *
 * ## 为什么藏在工具结果文本里，而不是新增持久化列
 *
 * 工具结果文本是「实时流」与「历史回放」**共用的唯一载体**：
 * server/api/chat/index.post.ts 把同一份 event.result 既落库为 role:'tool' 消息、
 * 又随 TOOL_END 事件发给前端。把来源元数据缝进这份文本，刷新页面后能从 DB 完整重建，
 * 无需任何新列 —— 与 3.8 图片白名单（app/utils/allowedImages.ts）完全同构。
 *
 * ## ⚠️ 安全前提（改动本文件前先读）
 *
 * 这段元数据是「信任锚」——它决定了 citation chip 能点向哪里；而它与**被检索到的
 * 文档正文同处一个字符串**。往知识库上传一份文档、正文里写一段伪造的 `⟦src[...]⟧`，
 * 就能污染白名单让用户点到攻击者指定的地址（与已堵的图片外链缺口同族）。
 * 三道防线：
 *   1. **固定写在偏移 0**，解析用 `^` 锚定 —— 伪造内容只能落在中后段，永远匹配不到
 *   2. **任何返回路径都必须输出**（哪怕是空数组 `⟦src[]⟧`），保证偏移 0 恒由工具自己写
 *   3. 解析出的字段仍逐项校验（UUID / host 白名单），见 parseCitationTrailer
 */

/** 引用元数据（工具写入 → 前端解析，前后端共用这一份契约） */
export interface CitationMeta {
  /** 片段稳定短 key = chunkId 前 12 位；LLM 引用标记 `[kb:{k}]` 用的就是它 */
  k: string
  /** 文档 id（前端拉详情做预览用） */
  d: string
  /** 知识库 id（文档被覆盖/删除时跳回知识库列表的兜底） */
  b: string
  /** chunkIndex（0 起）：标题路径缺失时降级展示「第 N 段」 */
  c: number
  /** 原文链接（仅 GitHub 引入的文档有），非 github.com 的会被清洗成 null */
  u: string | null
  /** 文档标题 */
  t: string
  /** 结构化标题路径（H1→当前节）；存量数据回填前为 null */
  h: string[] | null
}

/** 元数据块前后定界符（用罕见字符，与正文冲突概率近零） */
const OPEN = '⟦src['
const CLOSE = ']⟧'

/**
 * **解析**用：只匹配**偏移 0** 处的元数据块，且内部不允许出现 `⟦⟧`（防止跨块匹配）。
 * 见文件头「安全前提」第 1 条 —— 这个 `^` 是信任锚的边界，绝不能去掉。
 */
const TRAILER_RE = /^⟦src\[([^⟦⟧]*)\]⟧\n?/

/**
 * **剥离**用：匹配任意位置的元数据块。
 *
 * 与解析规则故意不同：解析必须锚定偏移 0（否则伪造块能进白名单），
 * 但剥离只是「删掉这段文字」——把正文里注入的伪造块一并删掉，既让工具卡片不显示噪音，
 * 也避免模型看到后模仿输出。删除不涉及信任判断，所以不设锚点。
 */
const TRAILER_ANY_RE = /⟦src\[[^⟦⟧]*\]⟧\n?/g

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/**
 * 短 key 长度 = 12 位十六进制（48 bit）。
 * 取 8 位（32 bit）时全库千级 chunk 的生日碰撞概率约 0.05%——概率虽低，但碰撞的后果是
 * 「两条来源同 key → 白名单里后者被顶掉 → 静默错引到另一篇文档」，用 4 个字符换掉这个风险很划算。
 */
const KEY_RE = /^[0-9a-f]{12}$/
/** sourceUrl 只放行这一个 host（值由我们自己的写入路径产生，白名单成本为零） */
const GITHUB_HOST = 'github.com'

/**
 * 由 chunkId 派生稳定短 key（12 位十六进制）。
 *
 * ⚠️ 必须先去掉连字符再截断：UUID 的第 9 位是 `-`，直接 slice(0,12) 会切出
 * `3f9a2c1d-4e5f` 这种带连字符的串，被 KEY_RE 拒绝后**整条白名单静默清空**——
 * 表现为所有引用都降级成纯文本，且不报任何错。
 * （取 8 位时恰好停在连字符前，所以旧实现没暴露这个问题。）
 */
export function citationKey(chunkId: string): string {
  return chunkId.replace(/-/g, '').slice(0, 12).toLowerCase()
}

/** 标题里若混入定界符会破坏解析 —— 写入侧先剔掉 */
function sanitizeTitle(title: string): string {
  return title.replace(/[⟦⟧]/g, '').slice(0, 200)
}

/** sourceUrl → 可信值或 null（见文件头「安全前提」第 3 条） */
function sanitizeUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname === GITHUB_HOST ? url : null
  } catch {
    return null
  }
}

/**
 * 构造元数据块（工具侧调用）。
 * 必须放在工具结果的**最前面**，且任何返回路径都要调用（哪怕传空数组）。
 */
export function buildCitationTrailer(metas: CitationMeta[]): string {
  const safe = metas.map(m => ({ ...m, t: sanitizeTitle(m.t) }))
  return `${OPEN}${JSON.stringify(safe)}${CLOSE}\n`
}

/** 逐条清洗：任一必填字段非法就丢弃该条（宁可不显示，也不让它决定跳转目标） */
function sanitizeMeta(raw: unknown): CitationMeta | null {
  if (raw === null || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>

  const k = typeof m.k === 'string' && KEY_RE.test(m.k) ? m.k : null
  const d = typeof m.d === 'string' && UUID_RE.test(m.d) ? m.d : null
  const b = typeof m.b === 'string' && UUID_RE.test(m.b) ? m.b : null
  if (!k || !d || !b) return null

  const h = Array.isArray(m.h) && m.h.every(x => typeof x === 'string') && m.h.length > 0
    ? (m.h as string[])
    : null

  return {
    k,
    d,
    b,
    c: typeof m.c === 'number' && Number.isFinite(m.c) ? m.c : 0,
    u: sanitizeUrl(typeof m.u === 'string' ? m.u : null),
    t: typeof m.t === 'string' ? m.t : '',
    h
  }
}

/** 解析偏移 0 处的元数据块；缺失/非法 → []（降级为「无 citation」，不报错） */
export function parseCitationTrailer(result: string | null | undefined): CitationMeta[] {
  if (!result) return []
  const payload = TRAILER_RE.exec(result)?.[1]
  if (!payload) return []
  try {
    const arr = JSON.parse(payload) as unknown
    if (!Array.isArray(arr)) return []
    return arr.map(sanitizeMeta).filter((m): m is CitationMeta => m !== null)
  } catch {
    return []
  }
}

/**
 * 剥掉元数据块。
 *
 * 服务端：AgentMemory 用它把元数据挡在 LLM 上下文之外（否则每条 ~130-180 字符，
 * 且每轮 LLM 调用重发一次，累积放大；模型还可能模仿输出它）。
 * 前端：工具卡片展开详情、图片白名单收集前先剥，免得把元数据糊给用户看 / 误当正文扫。
 */
export function stripCitationTrailer(result: string | null | undefined): string {
  if (!result) return ''
  return result.replace(TRAILER_ANY_RE, '')
}
