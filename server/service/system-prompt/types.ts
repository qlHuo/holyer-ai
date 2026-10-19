/**
 * PromptSegment — 系统提示词的最小拼装单元
 *
 * 每个 segment 负责一块独立内容（用户自定义、时间、工具准则、MCP 说明等），
 * 由 buildPrompt 按 priority 稳定排序后拼接，避免字符串散落在各处。
 */

export interface PromptSegment {
  id: string
  /** 数值越小越靠前 */
  priority: number
  content: string
}

/** 段位约定：留出间隔，便于后续插入新来源而不改动已有值 */
export const PROMPT_PRIORITY = {
  user: 0,
  date: 10,
  toolUsage: 20,
  mcp: 100
} as const
