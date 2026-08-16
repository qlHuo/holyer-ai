/**
 * Agent 运行时事件类型
 *
 * Runner 产出这些结构化事件，由上层（/api/chat）编码为 SSE 发送给前端。
 * Runner 不关心传输层（SSE/HTTP），只产出纯业务事件。
 */

/** 新一轮 ReAct 循环开始 */
export interface AgentRoundStartEvent {
  type: 'round_start'
  round: number
}

/** 工具调用开始 */
export interface AgentToolStartEvent {
  type: 'tool_start'
  toolCallId: string
  toolName: string
  arguments: string
}

/** 工具调用结束 */
export interface AgentToolEndEvent {
  type: 'tool_end'
  toolCallId: string
  toolName: string
  success: boolean
  result: string
  /** 是否来自缓存命中（未实际执行） */
  cached?: boolean
}

/** 最后一轮 LLM 文本输出 */
export interface AgentTextEvent {
  type: 'text'
  content: string
}

/** ReAct 循环正常结束 */
export interface AgentDoneEvent {
  type: 'done'
}

/** 错误事件 */
export interface AgentErrorEvent {
  type: 'error'
  message: string
}

export type AgentEvent
  = | AgentRoundStartEvent
    | AgentToolStartEvent
    | AgentToolEndEvent
    | AgentTextEvent
    | AgentDoneEvent
    | AgentErrorEvent

/** Agent 运行配置 */
export interface AgentRunConfig {
  /** 最大 ReAct 迭代轮数，默认 3 */
  maxIterations?: number
}
