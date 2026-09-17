import type { AgentToolCallItem } from '~/types/agent'
import type { Message } from '#shared/types/provider'
import type { CitationMeta } from '#shared/citation'
import { parseCitationTrailer } from '#shared/citation'

/**
 * 引用溯源（3.11）— 前端侧：从工具结果重建来源白名单、算展示编号
 *
 * 数据来源与图片白名单（app/utils/allowedImages.ts）**完全同构**：
 * search_knowledge_base 把来源元数据缝进自己的 result 文本，而这份文本
 * 既随 TOOL_END 事件实时到达、又原样落库为 role:'tool' 消息，
 * 经 buildRenderItems 折叠进 assistant 的 tools[].result ——
 * 所以流式与历史回放共用同一份数据，刷新页面后白名单自动重建，无需额外持久化。
 *
 * 两个白名单的判据也一致：**凡 LLM 可控的字符串都不能当信任来源**。
 * 这里只信「工具结果偏移 0 处的元数据块」（见 shared/citation.ts 的解析规则），
 * LLM 正文里写出的 key 必须能在白名单里查到才会渲染成 chip。
 */

/** LLM 引用标记：[kb:xxxxxxxxxxxx]（12 位十六进制，对应工具结果里的片段短 key） */
const MARKER_RE = /\[kb:([0-9a-f]{12})\]/gi

/**
 * 收集**整个对话**可引用的来源（白名单）：历史已落库的 tool 消息 + 本轮流式中的实时结果。
 *
 * 为什么是「整个对话」而不是「本轮」：LLM 的引用可以跨轮——用户追问同一主题时，
 * 模型常常不再检索、直接用上下文回答，此时它会复用上一轮答案里的 `[kb:xxx]`。
 * 若白名单按轮收窄，这些引用会全部悬空、降级成一串裸露的 `[kb:…]`。
 * 而 key 由 chunkId 派生（跨轮天然不冲突、同一 chunk 天然去重），合并零代价。
 *
 * ⚠️ 性能约定：**本函数只读 `role === 'tool'` 消息的 content**，不碰流式中的 assistant
 * content——否则每个 token 追加都会让 store 里那个 computed 失效，退化成「每 token 全量重扫历史」。
 */
export function collectCitationSources(
  messages: Message[],
  liveTools?: AgentToolCallItem[]
): Map<string, CitationMeta> {
  const map = new Map<string, CitationMeta>()
  const add = (result: string | null | undefined) => {
    if (!result) return
    for (const meta of parseCitationTrailer(result)) {
      if (!map.has(meta.k)) map.set(meta.k, meta)
    }
  }

  // 历史：已落库并被 buildRenderItems 折叠前的原始 tool 消息
  for (const m of messages) {
    if (m.role === 'tool') add(m.content)
  }
  // 本轮流式中：工具结果还在 agentToolCalls，尚未折回 messages（见 persistAgentToolCalls）
  for (const t of liveTools ?? []) {
    if (t.name === 'search_knowledge_base') add(t.result)
  }

  return map
}

/** 引用索引：正文里出现过的来源，及其展示编号 */
export interface CitationIndex {
  /** key → 展示编号（1 起，按正文中首次出现的顺序） */
  byKey: Map<string, number>
  /** 按展示编号排列的来源列表（只含正文**真正引用到**的片段，未被引用的不占号） */
  ordered: CitationMeta[]
}

/** 空索引（普通聊天 / 未触发检索时用，避免各调用点各 new 一遍） */
export function emptyCitationIndex(): CitationIndex {
  return { byKey: new Map<string, number>(), ordered: [] }
}

/**
 * 扫一遍正文，给出现过的 key 分配展示编号。
 *
 * 编号是**纯前端派生**的：实时流与历史回放的输入完全相同（正文 + 工具结果），
 * 所以两边算出的编号必然一致，不需要后端参与，也不需要持久化。
 * 不在白名单里的 key（LLM 编造、或引用了上一轮的旧 key）直接跳过、不占号。
 */
export function buildCitationIndex(content: string, citations: Map<string, CitationMeta>): CitationIndex {
  const byKey = new Map<string, number>()
  const ordered: CitationMeta[] = []
  if (!content || citations.size === 0) return { byKey, ordered }

  for (const m of content.matchAll(MARKER_RE)) {
    const key = m[1]!.toLowerCase()
    if (byKey.has(key)) continue
    const meta = citations.get(key)
    if (!meta) continue
    byKey.set(key, ordered.length + 1)
    ordered.push(meta)
  }

  return { byKey, ordered }
}

/** 来源展示名：「文档标题 › 小节 › 子节」；无标题路径时降级为「文档标题 · 第 N 段」 */
export function formatSourceLabel(meta: CitationMeta): string {
  const path = meta.h?.length ? ` › ${meta.h.join(' › ')}` : ` · 第 ${meta.c + 1} 段`
  return `${meta.t}${path}`
}

/** 预览时用来定位的锚点：标题路径的末级标题（无则 null，停在文档顶部） */
export function sourceAnchor(meta: CitationMeta): string | null {
  return meta.h?.length ? meta.h[meta.h.length - 1]! : null
}

/** 点击分流：有可信原文链接跳 GitHub，否则走系统内预览（见 shared/citation.ts 的 host 白名单） */
export function isExternalSource(meta: CitationMeta): boolean {
  return typeof meta.u === 'string' && meta.u.length > 0
}
