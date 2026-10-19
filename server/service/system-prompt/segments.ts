import type { PromptSegment } from './types'
import { PROMPT_PRIORITY } from './types'
import { buildDateContext } from './date-context'

/** 用户选择的 Prompt（来自请求体，可为空） */
export function userSegment(prompt: string): PromptSegment {
  return { id: 'user', priority: PROMPT_PRIORITY.user, content: prompt }
}

/** 当前时间 */
export function dateSegment(now?: Date): PromptSegment {
  return { id: 'date', priority: PROMPT_PRIORITY.date, content: buildDateContext(now) }
}

/** 内置工具调用准则（按实际可用工具生成，避免提到已被禁用的工具） */
export function toolUsageSegment(toolNames: string[]): PromptSegment {
  return {
    id: 'tool-usage',
    priority: PROMPT_PRIORITY.toolUsage,
    content: buildToolUsageGuidelines(toolNames)
  }
}

/**
 * 内置工具的准则文案。
 *
 * 顺序即输出顺序，改动时注意保持与既有 prompt 一致；
 * 只输出当前确实可用的工具，避免 LLM 被不存在的工具名误导。
 */
function buildToolUsageGuidelines(toolNames: string[]): string {
  const has = (name: string) => toolNames.includes(name)

  const lines: string[] = []
  if (has('web_search')) {
    lines.push('- 涉及实时信息、最新资讯、事实核查 → 调用 web_search')
  }
  if (has('web_fetch')) {
    lines.push('- 需要读取某个具体网页的内容 → 调用 web_fetch（需提供完整 URL）')
  }
  if (has('calculator')) {
    lines.push('- 涉及多位数字的算术运算 → 调用 calculator')
  }

  // 没有任何可识别的内置工具时不生成该段
  if (lines.length === 0) return ''

  lines.push('- 日常问候、闲聊、常识性问题 → 不要调用工具，直接回答')
  if (has('web_search')) {
    lines.push('- 用户明确要求「查询 / 搜索 / 查一下 / 最新」等信息时，应调用 web_search 获取最新结果，不要仅凭记忆回答')
  }

  return `## 工具调用准则
你可以使用工具来辅助回答问题。按以下规则选择是否调用及调用哪个工具：
${lines.join('\n')}`
}
