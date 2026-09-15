/**
 * tokenizer — 中文分词（全文检索的写侧/查侧共用）
 *
 * 设计（详见 docs/dev-log/2026-09-14-rag-stage-c-plan.md 3.9 节）：
 * - Intl.Segmenter('zh', { granularity: 'word' })：V8 内置、Node 18+ 与 Cloudflare Workers 均可用，零新依赖
 * - 只保留 isWordLike 片段（滤掉标点/空白），小写化，去停用词 —— 产出的词元用于 to_tsvector('simple', ...)
 * - 写侧 toIndexedText 与查侧 toQueryText 必须同源：两侧若用了不同分词规则，索引与查询不在同一分词空间，
 *   检索会「静默失效」（不报错，只是召回变噪声）
 * - 纯函数、零 Nitro 依赖：ingest service / retriever / 回填脚本三方复用（与 chunker.ts 同款风格）
 */

/**
 * 分词器版本：**改分词规则或停用词表时必须递增**，并全量重分词
 * （`npx tsx scripts/backfill-tokens.ts --force`），否则存量索引与新查询不同空间。
 */
export const TOKENIZER_VERSION = 'segmenter-zh-v1'

/**
 * 中英精简停用词表（保守：宁可少删，删多了丢召回）。
 * 动因：PostgreSQL 的 `simple` 配置不做停用词剔除、`ts_rank_cd` 也不做 IDF 加权，
 * 若不剔除，`的/是/在/the/of` 这类高频词会与 `neon-http` 这类精确术语同权，把排序拉平。
 */
const STOPWORDS = new Set<string>([
  // 中文虚词 / 高频功能词
  '的', '了', '是', '在', '和', '与', '就', '都', '而', '及', '或', '把', '被', '对', '从', '到',
  '这', '那', '有', '也', '还', '但', '并', '等', '着', '过', '之', '其', '为', '以', '于',
  '我', '你', '他', '它', '我们', '你们', '他们', '什么', '怎么', '为什么', '如何', '一个', '这个', '那个',
  '可以', '需要', '是否', '以及', '如果', '因为', '所以', '但是', '不过',
  // 英文常见停用词
  'a', 'an', 'the', 'of', 'to', 'in', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'for', 'and', 'or', 'on', 'at', 'it', 'this', 'that', 'with', 'by', 'from', 'as',
  'we', 'you', 'i', 'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should'
])

/** 模块级单例：Intl.Segmenter 构造有开销，复用同一个实例 */
const SEGMENTER = new Intl.Segmenter('zh', { granularity: 'word' })

/**
 * 分词：文本 → 词元数组。
 * 规则：保留 isWordLike 片段 → 小写化 → 去停用词。写侧/查侧共用本函数。
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  for (const { segment, isWordLike } of SEGMENTER.segment(text)) {
    if (!isWordLike) continue
    const token = segment.toLowerCase()
    if (STOPWORDS.has(token)) continue
    tokens.push(token)
  }
  return tokens
}

/**
 * 写侧：原文 → 空格分隔的索引文本。
 * 存入 `chunks.content_tokens`，由生成列 `content_tsv = to_tsvector('simple', content_tokens)` 消费。
 */
export function toIndexedText(text: string): string {
  return tokenize(text).join(' ')
}

/**
 * 查侧：查询 → 空格分隔的查询文本。
 * 当前与写侧实现相同；单独命名是为了「写/查可能分化」时改动点明确（改任一侧都要同步递增 TOKENIZER_VERSION）。
 */
export function toQueryText(text: string): string {
  return tokenize(text).join(' ')
}
