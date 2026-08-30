/**
 * chunker — Markdown 语义分块
 *
 * 设计（RAG 设计文档决策 1 + 扩展性设计）：
 * - 两层结构，parser（格式相关）→ chunker（格式无关），加格式只加 parser：
 *   - parseMarkdown：markdown → Section[]（策略 1：按标题切）
 *   - chunkSections：Section[] → Chunk[]（策略 2/3：超长按段落/长度切）
 * - 级联回退：标题 → 段落 → 固定长度 + overlap
 * - 元素分流：图片 alt→content、url→images；行内链接 url 剥离；代码块进 content
 *
 * 本文件是纯函数、零依赖（无 Nitro 自动导入、无 ~~/ 别名），
 * 可被灌库脚本（tsx）和运行时检索工具复用。
 */

/** 图片元数据（与 server/db/schema.ts 的 ChunkImage 对齐） */
export interface ChunkImage {
  url: string
  alt: string
}

/** 解析后的「节」——parser 的输出 / chunker 的输入 */
export interface Section {
  headingPath: string[] // 标题路径，如 ['分块策略', '级联回退']
  content: string // 这一节的正文
  images: ChunkImage[] // 图片元数据
}

/** 最终切片（对应 chunks 表的一行，不含向量） */
export interface Chunk {
  chunkIndex: number // 块序号（从 0 递增）
  headingPath: string[] // 标题路径（引用溯源）
  content: string // 切片文本（参与向量化）
  images: ChunkImage[] // 图片元数据（不参与向量化）
}

/** 分块参数 */
export interface ChunkOptions {
  maxChars: number // 单块最大字符数，超过就降级切
  overlap: number // 固定长度切块时相邻块共享的字符数
}

const DEFAULT_OPTIONS: ChunkOptions = {
  maxChars: 800,
  overlap: 80 // maxChars 的 10%
}

// ── parser 层：markdown → Section[] ──────────────────────────

/** 判断一行是否为 ATX 标题（# 开头），返回 [层级, 标题文本] 或 null */
function matchHeading(line: string): [number, string] | null {
  const m = line.match(/^(#{1,6})\s+(.+)$/)
  if (!m) return null
  const level = m[1]!.length
  const text = m[2]!.replace(/\s+#+\s*$/, '').trim() // 去掉尾部闭合的 #（## 标题 ##）
  return [level, text]
}

/** 处理普通行：提取图片（alt→文本、url→images）、剥离行内链接 */
function processLine(line: string, images: ChunkImage[]): string {
  // 图片 ![alt](url) → alt 留在文本，url 进 images
  let result = line.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (_, alt: string, url: string) => {
    images.push({ alt, url })
    return alt
  })
  // 行内链接 [文字](url) → 保留文字，剥离 url
  result = result.replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1')
  return result
}

/**
 * markdown → Section[]（策略 1：按标题切）
 * 代码围栏（``` / ~~~）内的行不参与标题识别、不做图片/链接处理。
 */
export function parseMarkdown(markdown: string): Section[] {
  const sections: Section[] = []
  const lines = markdown.split('\n')

  let headingStack: string[] = []
  let contentLines: string[] = []
  let images: ChunkImage[] = []
  let inCodeBlock = false

  const flush = () => {
    const content = contentLines.join('\n').trim()
    if (content) {
      sections.push({ headingPath: [...headingStack], content, images })
    }
    contentLines = []
    images = []
  }

  for (const line of lines) {
    // 1. 代码围栏（``` 或 ~~~）→ 切换状态，围栏行原样进 content
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inCodeBlock = !inCodeBlock
      contentLines.push(line)
      continue
    }

    // 2. 代码块内的行 → 原样保留（不识别标题、不处理图片/链接）
    if (inCodeBlock) {
      contentLines.push(line)
      continue
    }

    // 3. 标题 → 先 flush 上一节，再更新标题路径
    const h = matchHeading(line)
    if (h) {
      flush()
      const [level, text] = h
      headingStack = headingStack.slice(0, level - 1) // 只保留祖先标题
      headingStack.push(text)
      continue
    }

    // 4. 普通行 → 提取图片 + 剥离链接后进 content
    contentLines.push(processLine(line, images))
  }

  flush() // 最后一节
  return sections
}

// ── chunker 层：Section[] → Chunk[]（格式无关） ──────────────

/**
 * Section[] → Chunk[]（策略 2/3：超长节按段落切、超长段按长度切 + overlap）
 * 格式无关：任何 parser 产出的 Section[] 都能用这里分块。
 */
export function chunkSections(sections: Section[], options: ChunkOptions = DEFAULT_OPTIONS): Chunk[] {
  const chunks: Chunk[] = []
  for (const section of sections) {
    for (const piece of splitBySize(section.content, options)) {
      chunks.push({
        chunkIndex: chunks.length,
        headingPath: section.headingPath,
        content: piece,
        images: section.images
      })
    }
  }
  return chunks
}

/** 策略 2：超长内容按段落（空行）切；策略 3：超长段落按固定长度 + overlap 切 */
function splitBySize(content: string, options: ChunkOptions): string[] {
  if (content.length <= options.maxChars) return [content]

  const paragraphs = content.split(/\n\s*\n/) // 空行分隔
  const result: string[] = []
  for (const para of paragraphs) {
    const text = para.trim()
    if (!text) continue
    if (text.length <= options.maxChars) {
      result.push(text)
    } else {
      result.push(...splitByLength(text, options))
    }
  }
  return result
}

/** 策略 3：固定长度切块 + overlap（兜底，防拦腰切断） */
function splitByLength(text: string, options: ChunkOptions): string[] {
  const { maxChars, overlap } = options
  const result: string[] = []
  let start = 0
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length)
    result.push(text.slice(start, end))
    if (end >= text.length) break
    start = end - overlap
  }
  return result
}
