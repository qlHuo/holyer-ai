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

// ============================================================
// 内容审核自愈 — 问题 & 方案说明
// ============================================================
//
// 问题：Agent 调用 web_search 后，工具结果（网页文本）可能含敏感内容。
//       下一轮 LLM 调用时，API 安全过滤扫描整个请求体，命中后返回
//       HTTP 400 "Content Exists Risk"，用户得不到任何回复。
//
// 难点：400 是请求级别的——不告诉你具体哪条消息、哪段文字触发了过滤。
//
// 方案：反应式隔离（只在 400 出现时触发，零正常路径成本）
//       ① 逐条试毒：每条工具结果独立发极简 LLM 请求 → 判断是否被拦
//       ② 精确替换：只替换有问题的结果，干净的保留
//       ③ 渐进降级：隔离后仍被拒 → 全部替换为占位文本
//
// 为什么不前置过滤（每条都测）？每轮多 N 次 API 调用，延迟翻倍。
// 为什么不纯 truncate？信息损失大，且截断到多少字符安全纯属猜测。
// ============================================================

/**
 * 检测错误是否为 LLM API 内容审核拦截
 *
 * 匹配主流 API（DeepSeek、OpenAI 兼容）的内容过滤错误信息。
 * 注意不匹配 "rate" / "limit" 等，避免误判限流错误。
 */
function isContentFilterError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return /content.*risk|content.*filter|content_filter/i.test(msg)
}

/**
 * 逐条试毒：并行测试每条工具结果是否触发 LLM 内容审核
 *
 * 每条结果构造一个最小但结构一致的测试上下文发往 LLM：
 *   [user: "OK"] → [assistant(tool_calls)] → [tool: 完整搜索结果]
 *
 * 为什么用 assistant + tool 配对而不是直接当 user 消息？
 * 真实对话中敏感内容是 tool role，API 安全过滤可能对不同 role
 * 采用不同策略。保持结构一致可降低误判（测试通过但真实被拦）。
 *
 * 并行执行：N 条结果 ≈ 单次 API 调用延迟（~500ms）。
 *
 * @returns 被替换为占位文本的结果条数
 */
async function isolateAndFilterToolResults(
  memory: AgentMemory,
  provider: LLMProvider,
  options: ChatOptions
): Promise<number> {
  const toolMessages = memory.getToolMessages()
  if (toolMessages.length === 0) return 0

  // 并行试毒
  const checks = await Promise.all(
    toolMessages.map(async (msg) => {
      try {
        const testStream = await provider.chat(
          [
            { role: 'user', content: 'OK' },
            {
              role: 'assistant',
              content: '',
              toolCalls: [{ id: 'audit_check', name: 'check', arguments: '{}' }]
            },
            { role: 'tool', content: msg.content, toolCallId: 'audit_check' }
          ],
          { ...options, tools: undefined, maxTokens: 10 }
        )
        // 消费后立即取消，释放 HTTP 连接
        testStream.cancel().catch(() => {})
        return true // 通过审核
      } catch (error) {
        if (isContentFilterError(error)) return false // 被拦截
        // 其他错误（网络波动等）→ 保守保留，宁可多留不可误杀
        return true
      }
    })
  )

  // 替换有问题的结果
  let filteredCount = 0
  for (let i = 0; i < toolMessages.length; i++) {
    if (!checks[i]) {
      toolMessages[i]!.content = '（此搜索结果因内容限制不可用）'
      filteredCount++
    }
  }

  return filteredCount
}

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

      // 1. 调用 LLM — 带内容审核自愈
      //
      // 当上轮工具结果（如 web_search 返回的网页文本）含敏感内容时，
      // LLM API 安全过滤会对整个请求体做审核，直接返回 400。
      // 此处捕获后走"试毒 → 剔除 → 重试"流程，而非直接报错。
      let stream: ReadableStream<LLMStreamChunk>
      let contentWarning: string | undefined

      try {
        stream = await provider.chat(memory.getAll(), {
          ...options,
          tools: toolRegistry.getDefinitions()
        })
      } catch (error) {
        // 非内容审核错误 → 原样抛出
        if (!isContentFilterError(error) || round === 1) throw error

        // Level 1: 逐条试毒，精确定位并剔除有问题的工具结果
        const filteredCount = await isolateAndFilterToolResults(memory, provider, options)
        if (filteredCount > 0) {
          contentWarning = `（${filteredCount} 条搜索结果因内容限制未采用）\n\n`
        }

        try {
          // 重试时不传 tools：避免 LLM 再次搜索拿到同样的敏感内容，陷入死循环
          stream = await provider.chat(memory.getAll(), { ...options })
        } catch (retryError) {
          if (!isContentFilterError(retryError)) throw retryError

          // Level 2: 隔离后仍被拒（极少见，多条结果的组合触发审核）→ 全部替换为占位文本
          for (const msg of memory.getToolMessages()) {
            msg.content = '（此搜索结果因内容限制不可用）'
          }
          contentWarning = '（搜索结果因内容限制未采用，以下基于已有知识回答）\n\n'
          stream = await provider.chat(memory.getAll(), { ...options })
        }
      }

      // 降级后发出提示文本（在 LLM 真实回复之前）
      if (contentWarning) {
        yield { type: 'text', content: contentWarning }
      }

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
