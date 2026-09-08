// 定义共享的类型

/**
 * 消息接口，表示一次对话中的一条消息，包括角色、内容和可选的工具调用信息
 * - role: 消息的角色，可以是 system（系统提示词）、user（用户输入）或 assistant（AI 回复）
 * - content: 消息的文本内容
 * - toolCalls: 如果消息是 AI 回复，可能包含 LLM 发起的工具调用列表
 * - toolCallId: 如果消息是工具调用的结果，记录调用 ID 以便关联
*/
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
}

/**
 * 工具定义接口，表示可用工具的名称、描述和参数
 * - name: 工具的唯一名称
 * - description: 工具的功能描述，帮助 LLM 理解何时使用该工具
 * - parameters: 工具所需的参数结构，LLM 需要根据这个结构构造调用参数
*/
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, any>
}

/**
 * 工具调用接口，LLM 发起的一次工具调用，包括调用 ID、工具名称和参数
 * - id: 工具调用的唯一 ID，便于关联调用结果
 * - name: 被调用的工具名称，必须在可用工具列表中定义
 * - arguments: 调用该工具所需的参数，LLM 需要根据工具定义构造这个参数字符串
*/
export interface ToolCall {
  id: string
  name: string
  arguments: string
}

/**
 * 工具执行上下文 — 会话级配置，runner 透传给每个工具的 execute()
 *
 * 工具保持通用（不感知业务），需要"会话级"信息时从 ctx 读，而不是把业务逻辑写进工具。
 * 目前只服务知识库检索的范围约束（[knowledge-base-search.ts]）：
 * - kbIds: 限定检索范围（用户选了「指定知识库」）
 * - disabledTools: 本轮要禁用的工具名（用户选了「关闭知识库引用」→ 剔除 search_knowledge_base）
 */
export interface ToolContext {
  /** 限定 search_knowledge_base 的检索范围（custom 模式注入，空/未传则检索全部） */
  kbIds?: string[]
  /** 本轮要禁用的工具名（off 模式注入） */
  disabledTools?: string[]
}

/**
 * 聊天选项接口，表示一次对话的配置选项，包括模型名称、温度、最大 token 数、可用工具和系统提示词
 * - model: 使用的 LLM 模型名称，例如 "gpt-4"
 * - temperature: 生成文本的随机程度，值越高生成的文本越随机，默认为 0.7
 * - maxTokens: 生成文本的最大 token 数，默认为 2048
 * - tools: 可用工具列表，LLM 可以根据需要调用这些工具
 * - systemPrompt: 系统提示词，用于指导 LLM 的行为和回答风格
 * - toolContext: 会话级工具上下文，runner 透传给工具 execute（见 ToolContext）
*/
export interface ChatOptions {
  model: string
  temperature?: number
  maxTokens?: number
  tools?: ToolDefinition[]
  systemPrompt?: string
  /** AbortSignal — Provider 实现层用它取消底层的 LLM API 调用 */
  signal?: AbortSignal
  /** 会话级工具上下文，runner 逐轮透传给工具 execute */
  toolContext?: ToolContext
}

// LLM 响应流接口，表示 LLM 生成的文本流，包含文本内容
export interface LLMStreamTextChunk {
  type: 'text'
  content: string
}

// 工具调用流接口，表示 LLM 发出的工具调用结果，包含工具调用列表
export interface LLMStreamToolCallsChunk {
  type: 'tool_calls'
  toolCalls: ToolCall[]
}

// LLM 流结束由 ReadableStream 的 close()（reader.read() 返回 done:true）隐式表示，
// 不再单独发 done chunk——此前无任何消费者（Runner/filterTextChunks 都靠 read() 结束）。
export type LLMStreamChunk = LLMStreamTextChunk | LLMStreamToolCallsChunk
