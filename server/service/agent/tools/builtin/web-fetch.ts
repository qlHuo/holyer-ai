/**
 * 网页内容抓取工具 — 纯 fetch() + 正则提取
 *
 * 设计约束（Edge Runtime 兼容）：
 * - 无 DOM 解析器（无 jsdom/cheerio/linkedom）
 * - 纯正则提取文本内容
 * - 10s 超时 + 1MB 大小限制
 * - 移除 script/style 标签、多余空白
 */

import type { ExecutableTool, ToolPermission } from '../types'
import type { ToolDefinition } from '~~/shared/types/provider'
import { mergeAbortSignals } from '~~/server/utils/abort'

/** 最大响应体积：1MB */
const MAX_SIZE = 1_024_000

/** 请求超时：10s */
const TIMEOUT_MS = 10_000

export class WebFetchTool implements ExecutableTool {
  readonly name = 'web_fetch'
  readonly description = '获取指定网页的文本内容。输入一个完整的 URL（需包含 https://），返回提取后的纯文本。适用于阅读文章、查看文档或获取网页信息。仅在已确定具体 URL 时使用，不要猜测或编造 URL——若只有一个主题而没有 URL，请改用 web_search。'
  readonly permission: ToolPermission = 'readonly'
  readonly parameters: Record<string, any> = {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: '要获取的网页完整 URL，必须以 https:// 开头。例如 "https://zh.wikipedia.org/wiki/TypeScript"'
      }
    },
    required: ['url']
  }

  async execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const url = String(args.url ?? '').trim()
    if (!url) return '错误：URL 不能为空'

    try {
      // URL 合法性校验
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return '错误：仅支持 http:// 和 https:// 协议的 URL'
      }
      // SSRF 防护：拒绝内网/保留地址（云元数据、环回、私有网段）
      if (isPrivateHostname(parsed.hostname)) {
        return '错误：出于安全考虑，不允许访问内网或保留地址'
      }
    } catch {
      return `错误：无效的 URL 格式——"${url.slice(0, 100)}"`
    }

    // 合并「外部取消信号（客户端断开/Agent 超时）」与「自身 10s 超时」
    const timeoutController = new AbortController()
    const timeout = setTimeout(() => timeoutController.abort(), TIMEOUT_MS)
    const requestSignal = mergeAbortSignals(signal, timeoutController.signal)

    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'text/html, application/xhtml+xml',
          'User-Agent': 'HolyerBot/1.0 (Web Fetch Tool)'
        },
        signal: requestSignal,
        redirect: 'follow'
      })

      if (!response.ok) {
        return `获取网页失败：HTTP ${response.status} ${response.statusText}`
      }

      // 检查 Content-Type——只处理 HTML
      const contentType = response.headers.get('content-type') || ''
      const isHTML = contentType.includes('text/html') || contentType.includes('application/xhtml')

      // 读取文本（限制体积）
      const text = await response.text()
      const html = text.slice(0, MAX_SIZE)

      if (isHTML || !contentType) {
        return extractTextFromHTML(html, url)
      }

      // 非 HTML 内容：直接返回截断的纯文本
      return html.slice(0, 5000) + (text.length > 5000 ? '\n\n...（内容过长，已截断）' : '')
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // 区分：外部取消（用户停止/Agent 超时）vs 自身 10s 超时
        return signal?.aborted ? '已取消' : '请求超时（10 秒），目标网站响应过慢，请稍后重试。'
      }
      return `获取网页失败：${error instanceof Error ? error.message : '未知错误'}`
    } finally {
      clearTimeout(timeout)
    }
  }

  toDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters
    }
  }
}

/**
 * 判断 hostname 是否为内网/保留地址（SSRF 防护）
 *
 * Edge Runtime 无 dns 模块，无法做「域名 → IP 解析后再判断」的深度防护，
 * 只能拦截字面量内网地址。这不能防 DNS rebinding（域名解析到内网 IP），
 * 但对个人应用已足够阻断最常见的 SSRF 目标（云元数据、环回、私有网段）。
 */
function isPrivateHostname(hostname: string): boolean {
  // URL.hostname 对 IPv6 返回带方括号（如 "[::1]"），先剥离
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')

  // 环回 / localhost 及其子域
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  // IPv6 环回 / 未指定
  if (h === '::1' || h === '::' || h === '0:0:0:0:0:0:0:1' || h === '0:0:0:0:0:0:0:0') return true

  // IPv4 字面量内网段
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const a = Number(ipv4[1])
    const b = Number(ipv4[2])
    if (a === 0 || a === 127 || a === 10) return true // 0.0.0.0/8 · 127.0.0.0/8 · 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
    if (a === 192 && b === 168) return true // 192.168.0.0/16
    if (a === 169 && b === 254) return true // 169.254.0.0/16（link-local + 云元数据）
  }

  // 内网保留 TLD
  return /\.(internal|local|lan|home|corp|intranet)$/.test(h)
}

/**
 * 从 HTML 中提取纯文本内容（纯正则实现，Edge Runtime 兼容）
 *
 * 策略：
 * 1. 移除 script、style、svg、noscript 标签及其内容
 * 2. 移除所有 HTML 标签
 * 3. 解码常见 HTML 实体
 * 4. 压缩多余空白行
 */
function extractTextFromHTML(html: string, sourceUrl: string): string {
  // 1. 移除不可见元素
  let text = html
    .replace(/<script[\s>](?:(?!<\/script>)[\s\S])*?<\/script>/gi, '')
    .replace(/<style[\s>](?:(?!<\/style>)[\s\S])*?<\/style>/gi, '')
    .replace(/<svg[\s>](?:(?!<\/svg>)[\s\S])*?<\/svg>/gi, '')
    .replace(/<noscript[\s>](?:(?!<\/noscript>)[\s\S])*?<\/noscript>/gi, '')
    .replace(/<head[\s>](?:(?!<\/head>)[\s\S])*?<\/head>/gi, '')

  // 2. 将块级元素替换为换行（让排版有层次感）
  text = text.replace(/<\/(?:div|p|h[1-6]|li|tr|article|section|header|footer|main|nav|aside|table|ul|ol|blockquote|pre|figure|figcaption|details|summary|fieldset|form|dl|dt|dd)>/gi, '\n')
  text = text.replace(/<(?:br|hr)[\s/][^>]*?>/gi, '\n')

  // 3. 移除所有 HTML 标签（保留内容）
  text = text.replace(/<[^>]+>/g, '')

  // 4. 解码常见 HTML 实体
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))

  // 5. 压缩空白：多个换行 → 两个换行，多个空格 → 一个空格
  text = text.replace(/[ \t]+/g, ' ')
  text = text.replace(/\n{3,}/g, '\n\n')
  text = text.trim()

  // 6. 截断过长的结果（给 LLM 足够上下文但不过载）
  const MAX_OUTPUT = 8000
  if (text.length > MAX_OUTPUT) {
    text = text.slice(0, MAX_OUTPUT) + `\n\n...（内容过长，已截断，原文 ${(text.length / 1024).toFixed(0)}KB）`
  }

  return `来源：${sourceUrl}\n\n${text || '(未能提取到文本内容)'}`
}

export const webFetchTool = new WebFetchTool()
