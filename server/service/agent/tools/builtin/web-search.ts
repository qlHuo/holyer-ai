/**
 * 网络搜索工具 — 基于 Tavily Search API
 *
 * Tavily 是面向 AI Agent 的搜索 API，特点：
 * - Keyless 模式免注册直接可用（限频较高）
 * - 注册后 1000 次/月免费，无需绑卡（https://app.tavily.com）
 * - 返回 AI 优化过的结构化结果（标题 + URL + 内容 + 相关性评分）
 * - 支持 `search_depth: "advanced"` 深度搜索
 *
 * API 文档：https://docs.tavily.com/documentation/api-reference
 */

import type { ExecutableTool, ToolPermission } from '../types'
import type { ToolDefinition } from '~~/shared/types/provider'
import { mergeAbortSignals } from '~~/server/utils/abort'

const TAVILY_API = 'https://api.tavily.com/search'

/** 请求超时 */
const TIMEOUT_MS = 15_000

/** 最多返回结果数 */
const MAX_RESULTS = 5

interface TavilyResult {
  title: string
  url: string
  content: string
  score: number
}

interface TavilyResponse {
  query: string
  answer?: string
  results: TavilyResult[]
  response_time: number
}

export class WebSearchTool implements ExecutableTool {
  readonly name = 'web_search'
  readonly description = '在互联网上搜索信息。输入搜索关键词，返回相关网页的标题、URL 和内容摘要。适用于需要实时信息、事实核查或查找资料的场景。'
  readonly permission: ToolPermission = 'readonly'
  readonly parameters: Record<string, any> = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词，建议使用完整的自然语言问题以获得最佳结果。例如 "TypeScript 5.8 有哪些新特性" 或 "2026年诺贝尔物理学奖获得者"'
      }
    },
    required: ['query']
  }

  async execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const query = String(args.query ?? '').trim()
    if (!query) return '错误：搜索关键词不能为空'

    const config = useRuntimeConfig()
    const apiKey = (config as any).tavilyApiKey as string | undefined

    // 合并「外部取消信号（客户端断开/Agent 超时）」与「自身 15s 超时」
    const timeoutController = new AbortController()
    const timeout = setTimeout(() => timeoutController.abort(), TIMEOUT_MS)
    const requestSignal = mergeAbortSignals(signal, timeoutController.signal)

    try {
      const body: Record<string, unknown> = {
        query,
        search_depth: 'advanced',
        max_results: MAX_RESULTS,
        include_answer: true
      }
      if (apiKey) {
        body.api_key = apiKey
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      }
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`
      } else {
        // keyless 模式：免注册免费，有限频
        headers['X-Tavily-Access-Mode'] = 'keyless'
      }

      const response = await fetch(TAVILY_API, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: requestSignal
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        if (response.status === 429) {
          return '搜索请求过于频繁，请稍后重试。（Tavily keyless 模式有限频，注册免费 API Key 可提升至 1000 次/月：https://app.tavily.com）'
        }
        return `搜索请求失败：HTTP ${response.status} ${response.statusText}${errorText ? ` — ${errorText.slice(0, 200)}` : ''}`
      }

      const data = await response.json() as TavilyResponse

      // 无结果
      if (!data.results || data.results.length === 0) {
        return `未找到与 "${query}" 相关的结果。`
      }

      // 组装结果：AI 摘要（如有）+ 搜索结果列表（纯文本，无 markdown 标记）
      const parts: string[] = []

      if (data.answer) {
        parts.push(`AI 摘要：${data.answer}`)
      }

      parts.push(
        data.results
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content || '(无描述)'}`)
          .join('\n\n')
      )

      return parts.join('\n\n')
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // 区分：外部取消（用户停止/Agent 超时）vs 自身 15s 超时
        return signal?.aborted ? '已取消' : '搜索请求超时（15 秒），请稍后重试。'
      }
      return `搜索失败：${error instanceof Error ? error.message : '未知错误'}`
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

export const webSearchTool = new WebSearchTool()
