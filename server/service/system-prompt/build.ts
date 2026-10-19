import type { PromptSegment } from './types'
import { dateSegment, toolUsageSegment, userSegment } from './segments'

/** 按 priority 稳定排序、过滤空段后拼接 */
export function buildPrompt(segments: PromptSegment[]): string {
  return segments
    .filter(segment => segment.content.trim())
    .sort((a, b) => a.priority - b.priority)
    .map(segment => segment.content.trim())
    .join('\n\n')
}

export interface BuildSystemPromptOptions {
  /** 用户选择的 Prompt */
  userPrompt?: string
  /** 当前可用的工具名（内置 + 将来接入的 MCP） */
  toolNames: string[]
  /** 便于测试注入固定时间 */
  now?: Date
  /** 预留：MCP 等外部来源的附加段落 */
  extraSegments?: PromptSegment[]
}

/**
 * 组装完整 system prompt。
 *
 * 没有可用工具时只保留用户 Prompt——与改造前的行为一致
 * （时间与工具准则只在 Agent 路径下追加）。
 */
export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
  const segments: PromptSegment[] = []

  if (options.userPrompt) {
    segments.push(userSegment(options.userPrompt))
  }

  if (options.toolNames.length > 0) {
    segments.push(dateSegment(options.now))
    segments.push(toolUsageSegment(options.toolNames))
  }

  if (options.extraSegments?.length) {
    segments.push(...options.extraSegments)
  }

  return buildPrompt(segments)
}
