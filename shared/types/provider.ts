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
  parameters: object
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
 * 聊天选项接口，表示一次对话的配置选项，包括模型名称、温度、最大 token 数、可用工具和系统提示词
 * - model: 使用的 LLM 模型名称，例如 "gpt-4"
 * - temperature: 生成文本的随机程度，值越高生成的文本越随机，默认为 0.7
 * - maxTokens: 生成文本的最大 token 数，默认为 2048
 * - tools: 可用工具列表，LLM 可以根据需要调用这些工具
 * - systemPrompt: 系统提示词，用于指导 LLM 的行为和回答风格
*/
export interface ChatOptions {
  model: string
  temperature?: number
  maxTokens?: number
  tools?: ToolDefinition[]
  systemPrompt?: string
}
