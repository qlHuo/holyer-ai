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
 * - fence           → 代码块包裹在 .code-block-wrapper 中，预留语言标签和复制按钮
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

    // 外部链接（http/https）添加 target 和 rel
    if (href.startsWith('http://') || href.startsWith('https://')) {
      token.attrSet('target', '_blank')
      token.attrSet('rel', 'noopener noreferrer')
    }

    return defaultLinkOpen(tokens, idx, options, env, self)
  }

  // 图片：懒加载
  const defaultImage
    = _md.renderer.rules.image
      ?? function (tokens, idx, options, _env, self) {
        return self.renderToken(tokens, idx, options)
      }

  _md.renderer.rules.image = function (tokens, idx, options, env, self) {
    const token = tokens[idx]
    if (!token) return defaultImage(tokens, idx, options, env, self)

    token.attrSet('loading', 'lazy')
    return defaultImage(tokens, idx, options, env, self)
  }

  // 围栏代码块：包裹在 .code-block-wrapper 中，添加语言标签和复制按钮占位
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
      '<span class="code-copy-icon i-lucide-copy w-3.5 h-3.5"></span>',
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
 * 在 Markdown 渲染前对原始内容做预处理
 *
 * Phase 1：直接返回原文，不做任何处理
 * Phase 2：可在此处解析 :::tool-call 等自定义语法，
 *          将其替换为 markdown-it 能识别的 token 或占位 HTML
 */
export function preprocessMarkdown(content: string): string {
  return content
}
