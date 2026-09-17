/**
 * markdown-it 渲染工具
 *
 * 单例模式：模块级缓存 Md 实例，避免每次渲染都重新创建。
 *
 * 扩展点（Phase 2）：
 * - preprocessMarkdown() 钩子可在渲染前预处理内容，
 *   如解析 :::tool-call{name="xxx"} 自定义容器语法
 * - 可通过 md.use() 注册 markdown-it-container 等插件
 */
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import { type CitationIndex, emptyCitationIndex } from '~/utils/citations'

/** citation chip 的内部 scheme（preprocess 生成 → link_open 拦截，不会被浏览器解析） */
const KB_CITE_PREFIX = 'kb://cite/'

/** 工具结果里给每个片段打的引用短 key：[kb:xxxxxxxxxxxx] */
const CITATION_MARKER_RE = /\[kb:([0-9a-f]{12})\](?!\()/gi

// ---------------------------------------------------------------------------
// 单例
// ---------------------------------------------------------------------------

let _md: MarkdownIt | null = null

/**
 * 获取配置好的 markdown-it 实例（懒初始化）
 *
 * 规则说明：
 * - html: false     → 禁止原始 HTML（防 XSS），Agent 卡片通过 Vue 组件渲染
 * - linkify: true   → 自动将 URL 转为可点击链接
 * - breaks: true    → 单个换行 → <br>（符合聊天习惯）
 * - highlight       → 代码块语法高亮
 * - link_open       → 外部链接添加 target="_blank" 和安全属性
 * - image           → 图片懒加载
 * - fence           → 代码块包裹在 .code-block-wrapper 中，预留语言标签和复制按钮；
 *                     mermaid 特殊处理为 .mermaid 容器，前端流式结束后渲染 SVG
 */
export function getMarkdownParser(): MarkdownIt {
  if (_md) return _md

  _md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true,
    highlight(str: string, lang: string): string {
      // 未指定语言或 highlight.js 不支持时，返回转义后的纯文本
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value
        } catch {
          // 高亮失败时回退
        }
      }
      // 自动检测语言：开销较大，仅在未指定 lang 时使用
      if (!lang) {
        try {
          const result = hljs.highlightAuto(str)
          if (result.language) return result.value
        } catch {
          // 忽略
        }
      }
      // 最后回退：转义 HTML
      return _md!.utils.escapeHtml(str)
    }
  })

  // -- 自定义渲染规则 --------------------------------------------------------

  const defaultLinkOpen
    = _md.renderer.rules.link_open
      ?? function (tokens, idx, options, _env, self) {
        return self.renderToken(tokens, idx, options)
      }

  // 外部链接：新窗口打开 + 安全属性
  _md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
    const token = tokens[idx]
    if (!token) return defaultLinkOpen(tokens, idx, options, env, self)

    const href = token.attrGet('href') ?? ''

    // 引用溯源 chip（3.11）：preprocessMarkdown 只对**白名单内**的 key 生成这个 scheme，
    // 白名单外的 key 原样留在正文里当纯文本 —— 所以这里只做纯改写、**永远返回 <a>**。
    // 绝不能在此返回降级 HTML（如 <span>）：本规则的返回值与默认的 link_close（恒定吐 </a>）
    // 配对，返回非 <a> 会产生 `...1</a>` 这类不配对标签。跳转交给 MarkdownContent 的点击委托。
    if (href.startsWith(KB_CITE_PREFIX)) {
      token.attrSet('href', '#') // 换成 #，避免浏览器尝试解析 kb: 协议
      token.attrSet('class', 'citation-chip')
      token.attrSet('data-citation', href.slice(KB_CITE_PREFIX.length))
      token.attrSet('role', 'button')
      return defaultLinkOpen(tokens, idx, options, env, self)
    }

    // 外部链接（http/https）添加 target 和 rel
    if (href.startsWith('http://') || href.startsWith('https://')) {
      token.attrSet('target', '_blank')
      token.attrSet('rel', 'noopener noreferrer')
    }

    return defaultLinkOpen(tokens, idx, options, env, self)
  }

  // 图片：白名单 + 懒加载
  // 安全（RAG 决策 7 边界三）：markdown 原生图片语法会渲染 <img> 并让浏览器请求任意地址，
  // 是 prompt injection / LLM 幻觉诱导外链的敞开口子。这里只放行「显式白名单」内的绝对 http(s) URL，
  // 其余降级为文字占位、不发请求。白名单 env.allowedImages 由本轮 search_knowledge_base 返回的图片
  // URL 集合注入（普通聊天缺省为空集 → 一律降级）。
  const defaultImage
    = _md.renderer.rules.image
      ?? function (tokens, idx, options, _env, self) {
        return self.renderToken(tokens, idx, options)
      }

  function escapeHtmlAttr(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  _md.renderer.rules.image = function (tokens, idx, options, env, self) {
    const token = tokens[idx]
    if (!token) return defaultImage(tokens, idx, options, env, self)

    const src = token.attrGet('src') ?? ''
    const alt = token.children?.[0]?.content ?? ''
    const allowedImages = (env?.allowedImages as Set<string> | undefined) ?? new Set<string>()

    // 非绝对 http(s)（如本地文档的相对路径图）或不在本轮白名单 → 降级为文字，不发请求
    if (!/^https?:\/\//i.test(src) || !allowedImages.has(src)) {
      const label = alt ? `[图片：${escapeHtmlAttr(alt)}]` : '[图片]'
      return `<span class="text-muted">${label}</span>`
    }

    token.attrSet('loading', 'lazy')
    return defaultImage(tokens, idx, options, env, self)
  }

  // 围栏代码块：包裹在 .code-block-wrapper 中，添加语言标签和复制按钮占位
  // mermaid 特殊处理：输出 .mermaid 容器，前端在流式结束后通过 mermaid.run() 渲染 SVG
  const defaultFence
    = _md.renderer.rules.fence
      ?? function (tokens, idx, options, _env, self) {
        return self.renderToken(tokens, idx, options)
      }

  _md.renderer.rules.fence = function (tokens, idx, options, env, self) {
    const token = tokens[idx]
    if (!token) return defaultFence(tokens, idx, options, env, self)

    const lang = token.info?.trim().split(/\s+/)[0] || 'text'
    const rawCode = token.content

    // mermaid 图表：输出原始代码到 .mermaid 容器。
    // 前端在流式结束后通过 mermaid.run() 渲染为 SVG；
    // 流式期间 .mermaid 尚未被 mermaid 处理，CSS 将其显示为代码块样式。
    if (lang === 'mermaid') {
      // 使用 <pre> 而非 <div>：mermaid 11.x 通过 innerHTML 读取图表源码，
      // <pre> 保留换行和缩进空白符，<div> 会规范化空白导致语法解析失败。
      const escapedMermaid = _md!.utils.escapeHtml(rawCode)
      return `<pre class="mermaid">${escapedMermaid}</pre>`
    }

    // 获取高亮后的 HTML（调用 markdown-it 的 highlight 回调）
    const highlighted = options.highlight
      ? options.highlight(rawCode, lang, '')
      : _md!.utils.escapeHtml(rawCode)

    // 将原始代码编码后存入 data-code 属性，供复制按钮使用
    const escapedCode = rawCode.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

    return [
      '<div class="code-block-wrapper">',
      '<div class="code-block-header">',
      `<span class="code-lang">${_md!.utils.escapeHtml(lang)}</span>`,
      `<button class="code-copy-btn" data-code="${escapedCode}" title="复制代码">`,
      '<span class="code-copy-icon"></span>',
      '</button>',
      '</div>',
      `<pre><code class="hljs${lang ? ` language-${_md!.utils.escapeHtml(lang)}` : ''}">${highlighted}</code></pre>`,
      '</div>'
    ].join('\n')
  }

  return _md
}

// ---------------------------------------------------------------------------
// 预处理钩子（Phase 2 扩展点）
// ---------------------------------------------------------------------------

/**
 * 行内代码段之外的部分做替换。
 *
 * 按反引号分段：`a `b` c` → ['a ', '`', 'b', '`', ' c']，遇到反引号段就翻转 inCode
 * 状态。足以覆盖常见的单/多反引号行内代码，避免把代码里的 [kb:x] 也替换掉。
 * （不追求与 markdown-it 的 inline code 规则完全一致 —— 差异仅表现为代码里少替换一次。）
 */
function replaceOutsideInlineCode(line: string, replace: (text: string) => string): string {
  const segments = line.split(/(`+)/)
  let inCode = false
  return segments
    .map((seg) => {
      if (/^`+$/.test(seg)) {
        inCode = !inCode
        return seg
      }
      return inCode ? seg : replace(seg)
    })
    .join('')
}

/**
 * 在 Markdown 渲染前对原始内容做预处理
 *
 * 引用溯源（3.11）：把**白名单内**的 `[kb:xxxxxxxx]` 替换为 `[n](kb://cite/xxxxxxxx)`，
 * 由 link_open 渲染成可点击 chip。白名单外的 key（LLM 编造、或引用了上一轮检索的旧 key）
 * **原样保留**为纯文本 —— 降级可见，而不是静默指错。
 *
 * 白名单过滤放在这里而非 link_open，是因为 link_open 的返回值必须与默认 link_close
 * 配对（见该规则的注释）。
 */
export function preprocessMarkdown(content: string, citations?: CitationIndex): string {
  const index = citations ?? emptyCitationIndex()
  if (index.byKey.size === 0) return content

  const replace = (text: string): string =>
    text.replace(CITATION_MARKER_RE, (whole, key: string) => {
      const n = index.byKey.get(key.toLowerCase())
      return n ? `[${n}](${KB_CITE_PREFIX}${key.toLowerCase()})` : whole
    })

  const lines = content.split('\n')
  let inFence = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    // 围栏代码块（``` / ~~~）整段跳过，与 app/utils/github.ts 的图片改写同一套判定
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    lines[i] = replaceOutsideInlineCode(line, replace)
  }

  return lines.join('\n')
}
