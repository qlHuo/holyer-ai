/**
 * SSE 流式对话
 *
 * 流程：
 * 1. getOrCreateConversation  获取对话/新建对话
 * 2. 保存用户信息，发送的信息
 * 3. 调用LLM
 * 4. 构建 SSEChunk 事件流，交给createSSEResponse工具处理
 *
 * 关键设计逻辑：
 * 1. 所有的SSE事件都要携带 conversationId，前端据此将事件路由到正确的对话，支持多路会话并行流
 * 2. AbortSignal 用于取消 LLM API 调用，前端可取消对话
 * 3. 增量写入DB, 保证中途断开也不会丢失已接收的数据
*/
import { addMessages, deleteLastAssistantGroup, getOrCreateConversation, updateConversationById, insertMessage, updateMessage
} from '~~/server/service/conversation'
import { createLLMProvider } from '~~/server/service/llm/factory'
import type { SSEChunk } from '~~/server/utils/sse'
import type { ConversationDetail } from '~~/shared/types/conversation'
import type { ToolCall } from '~~/shared/types/provider'
import { createSSEResponse } from '~~/server/utils/sse'
import { ChatBodySchema } from './schema'
import { SSE_EVENT } from '~~/shared/types/sse'
import { runAgentLoop } from '~~/server/service/agent/runner'
import { toolRegistry } from '~~/server/service/agent/tools'

export default defineEventHandler(async (event) => {
  const body = ChatBodySchema.parse(await readBody(event))
  const {
    model,
    message,
    regenerate,
    conversationId, // 创建新会话时为空
    systemPrompt,
    temperature,
    maxTokens
  } = body

  // 1. 获取/创建对话
  let conv: ConversationDetail
  try {
    conv = await getOrCreateConversation(conversationId, { model })
  } catch (error: any) {
    if (error?.message === 'NOT FOUND') {
      throw createError({ statusCode: 404, message: '会话不存在' })
    }
    throw error
  }

  // 首条消息 → 用消息内容作为标题（覆盖「新建对话」时写入的默认标题）
  const isFirstMessage = conv.messages.length === 0
  const title = isFirstMessage
    ? (message[0]?.content?.slice(0, 50) || '新对话')
    : conv.title

  // 2. 保存用户信息（调用LLM之前，宁可多存不丢）
  // regenerate 为 true 时用户消息已在 DB 中，不重复写入
  if (!regenerate) {
    await addMessages(conv.id, message)
  }

  // 3. 拼装上下文：历史 + 当前用户信息
  let allMessages: typeof conv.messages
  if (regenerate) {
    // 去掉最后一次 assistant 回复的整组消息（Agent 场景含 tool_calls + tool 结果），LLM 不应看到它们
    const msgs = [...conv.messages]
    while (msgs.length > 0 && msgs[msgs.length - 1]!.role !== 'user') {
      msgs.pop()
    }
    allMessages = msgs
  } else {
    allMessages = [...conv.messages, ...message]
  }

  // 4. 创建 LLM Provider
  const llmProvider = createLLMProvider()

  // 创建 AbortController — 用于取消底层 LLM API 调用
  // 当客户端断开连接时，req.on('close') 触发 → abort() → signal 传给 Provider
  const llmAbortController = new AbortController()

  // 5. 构建SSE事件流
  const eventStream = new ReadableStream<SSEChunk>({
    async start(controller) {
      // 立即发meta 事件，前端获取conversationId，title
      controller.enqueue({ type: SSE_EVENT.META, conversationId: conv.id, title })

      // 监听取消请求
      // 1. 标记 isCancelled
      // 2. abort LLM API 调用，底层fetch被真正取消
      let isCancelled = false
      event.node?.req?.on('close', () => {
        isCancelled = true
        llmAbortController.abort()
      })

      // 首条消息 → 更新 DB 标题（在流开始前完成，确保 refreshConversationInList 读到新标题）
      if (isFirstMessage) {
        try {
          await updateConversationById(conv.id, { title })
        } catch {
          // 标题更新失败不阻塞对话
        }
      }

      // 最终回复消息 id 与内容缓冲提升到 try 外，供 catch 的中断兜底写入访问
      let finalMsgId: string | null = null
      let contentBuffer = ''

      try {
        // 必须要在LLM前删除并插入空message,原因在于llmProvider.chat当它 return ReadableStream 时，HTTP 响应体已经在接收数据，数据持续写入内部缓冲增加延迟
        if (regenerate) {
          await deleteLastAssistantGroup(conv.id)
        }
        // 最终回复消息 id —— 纯聊天路径提前占位；Agent 路径延后到第一个 text 事件才创建，
        // 保证中间轮的 assistant(tool_calls)/tool 消息在 DB 时间线上排在最终回复之前

        // 工具在 tools/index.ts 无条件注册，toolDefinitions 恒非空 → 所有请求都走 Agent 路径。
        // 原「纯聊天路径」else 分支是死代码，已删除；保留此判断作为「零工具模式」的未来扩展点。
        const toolDefinitions = toolRegistry.getDefinitions()

        // 有工具可用时，追加工具调用准则到 system prompt（防止 LLM 对"你好"也调工具）
        const now = new Date()
        const dateContext = `
          ## 当前时间
          今天是 ${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日（周${['日', '一', '二', '三', '四', '五', '六'][now.getDay()]}），当前时间是 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}（北京时间 UTC+8）。
          搜索实时信息时，请使用上述日期作为参考，不要使用过期的年份。
        `

        const toolUsageGuidelines = `
          ## 工具调用准则
          你可以使用工具来辅助回答问题。按以下规则选择是否调用及调用哪个工具：
          - 涉及实时信息、最新资讯、事实核查 → 调用 web_search
          - 需要读取某个具体网页的内容 → 调用 web_fetch（需提供完整 URL）
          - 涉及多位数字的算术运算 → 调用 calculator
          - 日常问候、闲聊、常识性问题 → 不要调用工具，直接回答
          - 用户明确要求「查询 / 搜索 / 查一下 / 最新」等信息时，应调用 web_search 获取最新结果，不要仅凭记忆回答
        `

        const effectiveSystemPrompt = toolDefinitions.length > 0
          ? [systemPrompt, dateContext, toolUsageGuidelines].filter(Boolean).join('\n\n')
          : systemPrompt

        const chatOptions = {
          model,
          systemPrompt: effectiveSystemPrompt,
          temperature,
          maxTokens,
          signal: llmAbortController.signal
        }

        let lastFlushLength = 0

        if (toolDefinitions.length > 0) {
          // ─── Agent 路径：AsyncGenerator<AgentEvent> → SSE ───
          const eventStream = runAgentLoop(llmProvider, allMessages, chatOptions)

          // 当前轮累积的 assistant tool_calls：tool_start 累积，第一个 tool_end 时落库并清空
          let pendingToolCalls: ToolCall[] = []

          for await (const event of eventStream) {
            if (isCancelled) break

            switch (event.type) {
              case 'round_start':
                pendingToolCalls = []
                controller.enqueue({
                  type: SSE_EVENT.ROUND_START,
                  round: event.round,
                  conversationId: conv.id
                })
                break

              case 'tool_start':
                pendingToolCalls.push({
                  id: event.toolCallId,
                  name: event.toolName,
                  arguments: event.arguments
                })
                controller.enqueue({
                  type: SSE_EVENT.TOOL_START,
                  toolName: event.toolName,
                  toolCallId: event.toolCallId,
                  args: event.arguments,
                  conversationId: conv.id
                })
                break

              case 'tool_end':
                // 本轮第一条 tool_end → 先把 assistant(tool_calls) 落库（串行保证顺序）
                if (pendingToolCalls.length > 0) {
                  await insertMessage(conv.id, { role: 'assistant', content: '', toolCalls: pendingToolCalls })
                  pendingToolCalls = []
                }
                // 再落 tool(result)
                await insertMessage(conv.id, {
                  role: 'tool',
                  content: event.result,
                  toolCallId: event.toolCallId
                })
                controller.enqueue({
                  type: SSE_EVENT.TOOL_END,
                  toolName: event.toolName,
                  toolCallId: event.toolCallId,
                  result: event.result,
                  success: event.success,
                  conversationId: conv.id
                })
                break

              case 'text':
                // 最终回复：首次 text 时才创建占位消息（此时才是时间线末端）
                if (!finalMsgId) {
                  finalMsgId = (await insertMessage(conv.id, { role: 'assistant', content: '' })).id
                }
                contentBuffer += event.content
                controller.enqueue({
                  type: SSE_EVENT.TEXT,
                  content: event.content,
                  conversationId: conv.id
                })
                // 每累积 2000 字符增量落库一次：阈值太小（原 200）会在长回答下频繁写 DB，
                // 耗尽 Cloudflare 免费计划的 50 次 subrequest 配额；2000 字 ≈ 1~2 分钟生成量，
                // 既够稀疏避免超限，又保留刷新保护（最多丢最后 2000 字）
                if (contentBuffer.length - lastFlushLength >= 2000) {
                  await updateMessage(finalMsgId!, { content: contentBuffer })
                  lastFlushLength = contentBuffer.length
                }
                break

              case 'error':
                // 达到 maxIterations 上限 / Agent 超时且尚无最终回复时，落一条 assistant 消息
                // 记录错误文案，避免用户刷新后只看到工具消息、无最终回复
                if (!finalMsgId) {
                  finalMsgId = (await insertMessage(conv.id, { role: 'assistant', content: event.message })).id
                }
                controller.enqueue({
                  type: SSE_EVENT.ERROR,
                  content: event.message,
                  conversationId: conv.id
                })
                break

              case 'done':
                break
            }
          }
        }

        // 流结束，最终保存 assistant 消息
        if (contentBuffer && finalMsgId) {
          await updateMessage(finalMsgId, { content: contentBuffer })
        }

        // 正常结束 → DONE
        if (!isCancelled) {
          controller.enqueue({
            type: SSE_EVENT.DONE,
            conversationId: conv.id
          })
        }
      } catch (error) {
        // 用户中断请求：abort 前把已生成的内容兜底落库，避免刷新后「记录不存在 / 空消息残留」
        if (error instanceof Error && error.name === 'AbortError') {
          if (contentBuffer && finalMsgId) {
            try {
              await updateMessage(finalMsgId, { content: contentBuffer })
            } catch {
              // 兜底写入失败静默忽略——已尽力，不阻塞中断流程
            }
          }
          return
        }
        // Drizzle 的 DrizzleQueryError 把真正的 DB 错误藏在 cause 里（message 只含 SQL + params），
        // 这里把 cause 揪出来：既打到日志供 wrangler tail 排查，也附到 SSE 让前端能看到真实原因。
        const cause = (error as { cause?: { code?: string, message?: string, detail?: string } })?.cause
        const causeText = cause
          ? [cause.code, cause.message, cause.detail].filter(Boolean).join(' · ')
          : ''
        console.error('[chat] 流式处理失败:', error, causeText && `\nDB cause: ${causeText}`)
        if (!isCancelled) {
          controller.enqueue({
            type: SSE_EVENT.ERROR,
            content: error instanceof Error
              ? (causeText ? `${error.message}\n（数据库错误：${causeText}）` : error.message)
              : 'LLM调用失败',
            conversationId: conv.id
          })
        }
      } finally {
        controller.close()
      }
    }
  })

  return createSSEResponse(eventStream, event)
})
