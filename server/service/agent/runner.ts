/**
 * Agent runner - ReAct 循环核心
 *
 * 职责：接收消息列表，循环调用 LLM，检测到 tool_calls 时自动执行工具并将结果回传，
 * 直到 LLM 不再调用工具给出最终文本回复或超过最大迭代数。
 *
 * 返回 AsyncGenerator<AgentEvent>，上层（/api/chat）编码为 SSE 事件发送给前端。
 *
 * 架构要点：
 * - 中间轮（有 tool_calls）：发出 ROUND_START + TOOL_START + TOOL_END，不发出文本
 * - 最后一轮（无 tool_calls）：发出 TEXT + DONE
 * - 工具并发执行：同一轮内的多个 tool_calls 通过 Promise.allSettled 并发
 * - AgentMemory：消息裁剪，保留 system + 最近 40 条，不拆散 tool call 配对
 */

import type { Message, ToolCall, ChatOptions } from '~~/shared/types/provider'
import type { LLMProvider } from '~~/server/service/llm/types'
import type { AgentEvent, AgentRunConfig } from './types'
import { toolRegistry } from './tools'
import { AgentMemory } from './memory'

/** 最大 ReAct 迭代轮数（硬上限，防止无限循环） */
const DEFAULT_MAX_ITERATIONS = 10

/** Agent 整体超时（毫秒），超时后强制终止 ReAct 循环 */
const AGENT_TIMEOUT_MS = 60_000

/**
 * 执行 Agent ReAct 循环
 *
 * @param provider  - LLMProvider 实例
 * @param messages  - 消息列表（system + 历史 + 当前用户消息）
 * @param options   - 聊天选项（model、temperature、maxTokens、systemPrompt、signal）
 *                    注意：tools 由 Runner 内部自动设置，不依赖 options.tools
 * @param config    - Agent 运行配置（maxIterations 等）
 */
export async function* runAgentLoop(
  provider: LLMProvider,
  messages: Message[],
  options: ChatOptions,
  config: AgentRunConfig = {}
): AsyncGenerator<AgentEvent> {
  const maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS
  const externalSignal = options.signal

  // 启动内部超时定时器——仅限制 ReAct 循环耗时，不覆盖外层 DB 操作或纯聊天路径
  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => timeoutController.abort(), AGENT_TIMEOUT_MS)

  // 工具结果缓存：同一轮 Agent 运行中，相同工具+相同参数不重复执行
  // 解决 LLM "失忆"导致重复调用同一工具的问题（尤其是 Memory 裁剪后）
  const toolCache = new Map<string, { result: string, success: boolean }>()

  try {
    // 检查是否已被取消（合并外部 signal + 内部超时）
    function isAborted(): boolean {
      return externalSignal?.aborted === true || timeoutController.signal.aborted
    }

    // 初始化 AgentMemory——自动分离 system 消息，后续自动裁剪
    const memory = new AgentMemory(messages)

    for (let round = 1; round <= maxIterations; round++) {
      if (isAborted()) {
        yield {
          type: 'error',
          message: timeoutController.signal.aborted
            ? 'Agent 执行超时（60s），请简化提问后重试'
            : '请求已取消'
        }
        return
      }

      // 1. 调用 LLM——始终带上全量工具定义（LLM 自行判断是否需要调用）
      const stream = await provider.chat(memory.getAll(), {
        ...options,
        tools: toolRegistry.getDefinitions()
      })

      // 2. 读取 LLM 响应流：文本逐 chunk 流式发出，tool_calls 累积后在循环结束时处理
      //    策略：仅在没有 tool_calls 的阶段流式输出文本。一旦 tool_calls 出现，
      //    后续文本不再发出（LLM 通常不会在 tool_calls 后输出文本）。
      const textParts: string[] = []
      const toolCalls: ToolCall[] = []

      const reader = stream.getReader()
      try {
        while (true) {
          if (isAborted()) {
            yield {
              type: 'error',
              message: timeoutController.signal.aborted
                ? 'Agent 执行超时（60s），请简化提问后重试'
                : '请求已取消'
            }
            return
          }

          const { done, value } = await reader.read()
          if (done) break

          if (value.type === 'text') {
            textParts.push(value.content)
            if (toolCalls.length === 0) {
              yield { type: 'text', content: value.content }
            }
          } else if (value.type === 'tool_calls') {
            toolCalls.push(...value.toolCalls)
          }
        }
      } finally {
        reader.releaseLock()
      }

      const assistantContent = textParts.join('')

      // 3. 无 tool_calls → 最后一轮
      if (toolCalls.length === 0) {
        yield { type: 'done' }
        return
      }

      // 4. 有 tool_calls → 中间轮
      yield { type: 'round_start', round }

      memory.add({
        role: 'assistant',
        content: assistantContent,
        toolCalls
      })

      // 5a. 先发出所有 tool_start 事件
      for (const tc of toolCalls) {
        yield {
          type: 'tool_start',
          toolCallId: tc.id,
          toolName: tc.name,
          arguments: tc.arguments
        }
      }

      if (isAborted()) {
        yield {
          type: 'error',
          message: timeoutController.signal.aborted
            ? 'Agent 执行超时（60s），请简化提问后重试'
            : '请求已取消'
        }
        return
      }

      // 5b. 并发执行所有工具（缓存优先：相同工具+相同参数不重复执行）
      const registeredNames = toolRegistry.list().map(t => t.name)

      const settled = await Promise.allSettled(
        toolCalls.map(async (tc) => {
          try {
            const tool = toolRegistry.get(tc.name)
            if (!tool) {
              return {
                toolCallId: tc.id,
                toolName: tc.name,
                success: false as const,
                result: `错误：工具 "${tc.name}" 未注册。已注册工具：[${registeredNames.join(', ')}]`,
                cached: false as const
              }
            }

            const args = JSON.parse(tc.arguments) as Record<string, unknown>
            // 生成缓存 key：工具名 + 排序后的参数 JSON（保证 {a:1,b:2} 和 {b:2,a:1} 命中同一缓存）
            const cacheKey = `${tc.name}:${JSON.stringify(args, Object.keys(args).sort())}`

            // 命中缓存 → 直接返回，不实际执行
            const cached = toolCache.get(cacheKey)
            if (cached) {
              return {
                toolCallId: tc.id,
                toolName: tc.name,
                success: cached.success,
                result: cached.result,
                cached: true as const
              }
            }

            // 未命中 → 实际执行并写入缓存
            const result = await tool.execute(args)
            toolCache.set(cacheKey, { result, success: true })
            return {
              toolCallId: tc.id,
              toolName: tc.name,
              success: true as const,
              result,
              cached: false as const
            }
          } catch (error) {
            return {
              toolCallId: tc.id,
              toolName: tc.name,
              success: false as const,
              result: `工具执行异常：${error instanceof Error ? error.message : '未知错误'}`,
              cached: false as const
            }
          }
        })
      )

      // 5c. 发出 tool_end 事件 + 写入 AgentMemory
      for (const item of settled) {
        if (item.status === 'fulfilled') {
          const { toolCallId, toolName, success, result, cached } = item.value
          yield { type: 'tool_end', toolCallId, toolName, success, result, cached }
          memory.add({
            role: 'tool',
            content: result,
            toolCallId
          })
        } else {
          yield {
            type: 'tool_end',
            toolCallId: 'unknown',
            toolName: 'unknown',
            success: false,
            result: `工具执行异常：${item.reason instanceof Error ? item.reason.message : '未知错误'}`
          }
        }
      }

      // 6. 进入下一轮
    }

    // 达到最大迭代轮数
    yield { type: 'error', message: '已达到工具调用次数上限，请简化提问后重试' }
  } finally {
    clearTimeout(timeoutId)
  }
}
