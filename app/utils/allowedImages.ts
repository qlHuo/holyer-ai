import type { AgentToolCallItem } from '~/types/agent'
import { stripCitationTrailer } from '#shared/citation'

/**
 * 收集「允许渲染」的图片 URL 集合（白名单，RAG 设计决策 7 边界二）
 *
 * search_knowledge_base 工具把命中的 chunk 附图以 markdown（![alt](url)）拼进
 * result（仅绝对 http(s) URL），因此同一轮里该工具 result 出现的图片 URL =
 * 本轮检索返回的图 = 白名单。渲染 assistant 回答时只有集合内的 URL 出图，
 * 其余降级为文字——LLM 幻觉或文档注入的任意外链 URL 天然不在集合内，发不出请求。
 *
 * 历史/流式共用同一来源：buildRenderItems 已把同轮 tool 结果折叠进 assistant 的
 * tools[].result，重开对话后从 DB 重建白名单，无需额外持久化。
 */
const IMAGE_URL_RE = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g

export function collectAllowedImagesFromTools(tools?: AgentToolCallItem[]): Set<string> {
  const set = new Set<string>()
  if (!tools) return set
  for (const t of tools) {
    if (t.name !== 'search_knowledge_base' || !t.result) continue
    // 先剥掉 citation 元数据块再扫（其字段里同样可能出现 markdown 图片语法，不该被当成本轮图片）
    for (const m of stripCitationTrailer(t.result).matchAll(IMAGE_URL_RE)) {
      if (m[1]) set.add(m[1])
    }
  }
  return set
}
