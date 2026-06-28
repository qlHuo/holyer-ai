/**
 * SSE 流式聊天
 *
 * 核心行为：
 * - sendMessage / regenerate  发起 SSE 流，注册到 streamSessions
 * - abort()                   真正停止（abort fetch → 服务端检测断开 → 停止 LLM + DB 写入）
 * - switchConversation(id)    切换对话：保留旧流继续后台运行，切回时恢复实时输出
 * - isSending                 按对话计算（computed），不再全局锁
 *
 * 设计决策：
 * - 模块级单例：streamSessions + sendingConvIds 全局唯一，保证多次调用 useChat() 共享状态
 * - 切换 ≠ 停止：切换对话时旧流保持（继续写入 DB），只有用户主动点"停止"才 abort
 * - 三层防线不变：abort fetch → aborted 标志检查 → streamingConvId Store 校验
 */

import type { Message } from '#shared/types/provider'
import { extractSSEField } from '~/utils/sse'
import { SSE_EVENT } from '~~/shared/types/sse'
import ConversationApi from '~/api/conversations'
import ChatApi from '~/api/chat'

interface StreamSession {
  convId: string
  abortController: AbortController
  contentBuffer: string
  isActive: boolean
}

/** 所有活跃的流会话（key = conversationId 或 '__pending__'） */
const streamSessions = new Map<string, StreamSession>()

/** 活跃流的对话 ID 集合（用于 isSending 按对话判断） */
const sendingConvIds = ref(new Set<string>())

export function useChat() {
  // ★ 必须在 useChat() 内部获取 — 模块顶层时 Pinia 尚未初始化
  const chatStore = useChatStore()

  /**
   * isSending — 按对话计算，不再全局锁
   *
   * 当前对话正在发送时才为 true，其他对话不受影响。
   * 无对话时（Path B 新对话）检查 '__pending__' 临时 key。
   */
  const isSending = computed(() => {
    const convId = chatStore.currentConvId
    return convId ? sendingConvIds.value.has(convId) : sendingConvIds.value.has('__pending__')
  })

  /** 流错误（来自 Store，便于组件 watch） */
  const error = computed(() => chatStore.streamError)

  /**
   * 发送消息并 SSE 流式接收
   */
  async function sendMessage(content: string) {
    const convId = chatStore.currentConvId
    if (!content.trim()) return
    if (sendingConvIds.value.has(convId ?? '__pending__')) return

    // 1. 构造用户消息
    const userMessage: Message = { role: 'user', content: content.trim() }

    // 2. 立即添加用户消息到列表
    chatStore.addMessage(userMessage)

    // 3. 开始流式状态
    chatStore.startStreaming()

    // 4. 创建 session（新对话用 '__pending__' 临时 key，META 事件到达后 re-key）
    const abortCtrl = new AbortController()
    const sessionKey = convId ?? '__pending__'

    const session: StreamSession = {
      convId: sessionKey,
      abortController: abortCtrl,
      contentBuffer: '',
      isActive: true
    }
    streamSessions.set(sessionKey, session)
    sendingConvIds.value = new Set([...sendingConvIds.value, sessionKey])

    try {
      const response = await ChatApi.sendChatMessage(
        {
          provider: chatStore.selectedProvider,
          model: chatStore.selectedModel,
          message: [userMessage],
          conversationId: chatStore.currentConvId
        },
        abortCtrl.signal
      )
      await consumeSSEStream(response, session)
    } catch (err: any) {
      handleStreamError(err, session)
    } finally {
      cleanupSession(session)
    }
  }

  /**
   * 重新生成最后一条 assistant 消息
   */
  async function regenerate() {
    const convId = chatStore.currentConvId
    if (!convId) return
    if (sendingConvIds.value.has(convId)) return

    const msgs = chatStore.messages
    const lastMsg = msgs[msgs.length - 1]
    if (!lastMsg || lastMsg.role !== 'assistant') return

    // 1. 移除旧 assistant（UI 上消失）
    msgs.pop()

    // 2. 开始流式状态
    chatStore.startStreaming()

    const abortCtrl = new AbortController()

    const session: StreamSession = {
      convId,
      abortController: abortCtrl,
      contentBuffer: '',
      isActive: true
    }
    streamSessions.set(convId, session)
    sendingConvIds.value = new Set([...sendingConvIds.value, convId])

    try {
      const response = await ChatApi.sendChatMessage({
        provider: chatStore.selectedProvider,
        model: chatStore.selectedModel,
        message: [],
        conversationId: chatStore.currentConvId,
        regenerate: true
      }, abortCtrl.signal)
      await consumeSSEStream(response, session)
    } catch (err: any) {
      handleStreamError(err, session)
    } finally {
      cleanupSession(session)
    }
  }

  /**
   * 读取 SSE Response，解析事件帧并分发
   *
   * 增加 aborted 标志检查（第二层防线），丢弃 abort 后的缓冲区残留帧。
   */
  async function consumeSSEStream(response: Response, session: StreamSession) {
    if (!response.ok) {
      throw new Error(`请求失败： ${response.status} ${response.statusText}`)
    }
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('无法读取响应流')
    }

    const decoder = new TextDecoder()
    let buffer = ''

    // 第二层防线：abort 后丢弃缓冲区残留帧
    let aborted = false
    session.abortController.signal.addEventListener('abort', () => {
      aborted = true
    })

    while (true) {
      if (aborted) break

      const { done, value } = await reader.read()
      if (done) break

      // read() 返回后再检查一次 — abort 可能在 read() 等待期间触发
      if (aborted) break

      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() || ''
      for (const frame of frames) {
        if (!frame.trim()) continue
        const eventType = extractSSEField(frame, 'event')
        const data = extractSSEField(frame, 'data')
        if (!data) continue
        if (eventType === SSE_EVENT.PING) continue
        try {
          const payload = JSON.parse(data)
          handleSSEEvent(payload, session)
        } catch (error) {
          console.error(error)
        }
      }
    }
  }

  /**
   * 统一的流错误处理
   *
   * AbortError（用户主动中断）→ 同步清理 UI（如果当前正在看这个对话）
   * 真实错误 → 设置错误状态（同上，仅当前对话）
   */
  function handleStreamError(err: any, session: StreamSession) {
    if (err.name === 'AbortError') {
      // 用户主动中断 → 同步清理（不依赖异步传播）
      if (session.convId === chatStore.currentConvId) {
        chatStore.finishStreaming()
      }
    } else {
      // 真实错误 → 只在当前对话显示
      if (session.convId === chatStore.currentConvId) {
        chatStore.streamError = err.message || '网络请求失败'
        chatStore.finishStreaming()
      }
    }
  }

  /**
   * 分发 SSE 事件
   *
   * 后端事件类型：
   * - meta:   { type: 'meta', conversationId: string, title: string }
   * - text:   { type: 'text', content: string, conversationId: string }
   * - done:   { type: 'done', conversationId: string }
   * - error:  { type: 'error', content: string, conversationId: string }
   *
   * 路由规则：
   * - TEXT 事件：始终累积到 session.contentBuffer；只有当前前台对话才写 UI
   * - DONE/ERROR：只有当前前台对话才修改 Store 状态
   * - META：Path B re-key（'__pending__' → 真实 ID）
   */
  function handleSSEEvent(
    payload: { type: string, conversationId?: string, [key: string]: any },
    session: StreamSession
  ) {
    const eventConvId = payload.conversationId

    switch (payload.type) {
      case SSE_EVENT.META:
        // Path B re-key：新对话的临时 session（'__pending__'）→ 真实 ID
        if (eventConvId) {
          if (session.convId === '__pending__') {
            streamSessions.delete('__pending__')
            session.convId = eventConvId
            streamSessions.set(eventConvId, session)

            // 同步更新 sendingConvIds
            sendingConvIds.value = new Set(
              [...sendingConvIds.value].map(id => id === '__pending__' ? eventConvId : id)
            )
          }

          // 对话不在列表中 → 添加
          if (!chatStore.currentConvId) {
            chatStore.setCurrentConvId(eventConvId, payload.title as string | undefined)
          }

          // 更新列表标题
          chatStore.updateConversationItem(eventConvId, {
            title: payload.title as string
          })
        }
        break

      case SSE_EVENT.TEXT:
        if (payload.content) {
          // 始终累积到 buffer（切回时用于恢复完整内容）
          session.contentBuffer += payload.content
          // 只有当前前台对话才写 UI
          if (eventConvId && eventConvId === chatStore.currentConvId) {
            chatStore.appendStreamContent(payload.content)
          }
        }
        break

      case SSE_EVENT.DONE:
        // 只有当前前台对话才清理 UI 状态
        // 后台流结束 → 只刷新列表 + 清理 session（在 finally 中）
        if (eventConvId === chatStore.currentConvId) {
          chatStore.finishStreaming()
          chatStore.streamError = null
        }
        if (eventConvId) {
          refreshConversationInList(eventConvId)
        }
        break

      case SSE_EVENT.ERROR:
        // 只有当前前台对话才显示错误
        if (eventConvId === chatStore.currentConvId) {
          chatStore.streamError = payload.content || '未知错误'
          chatStore.finishStreaming()
        }
        break

      default:
        break
    }
  }

  /** 流结束后刷新列表中的对话项（标题、预览、消息数） */
  async function refreshConversationInList(id: string) {
    try {
      const data = await ConversationApi.getDetailById(id)
      const lastMsg = data.messages[data.messages.length - 1]
      chatStore.updateConversationItem(id, {
        title: data.title,
        messageCount: data.messages.length,
        lastPreview: lastMsg?.content?.slice(0, 50) || null,
        updatedAt: data.updatedAt
      })
    } catch (error) {
      console.error(error)
    }
  }

  /**
   * 恢复流式会话 — 切换回有活跃流的对话时调用
   *
   * 1. 从 DB 加载消息（最多落后 199 字符）
   * 2. 用 session.contentBuffer（完整内容）替换最后一条 assistant
   * 3. 通过 skipLoad + presetMessages 注入 Store，避免二次加载
   * 4. 初始化 streamContent，后续 TEXT 事件在此之上追加
   */
  async function restoreStreamSession(convId: string) {
    const session = streamSessions.get(convId)
    if (!session?.isActive) return

    // 1. 从 DB 加载消息
    const data = await ConversationApi.getDetailById(convId)
    const msgs = [...data.messages]

    // 2. 用 buffer（完整内容）替换最后一条 assistant
    const last = msgs[msgs.length - 1]
    if (last?.role === 'assistant' && session.contentBuffer) {
      last.content = session.contentBuffer
    }

    // 3. 注入 Store（skipLoad 避免二次 DB 请求）
    chatStore.selectConversation(convId, {
      skipLoad: true,
      presetMessages: msgs,
      presetProvider: data.provider,
      presetModel: data.model
    })

    // 4. 初始化 streamContent — 后续 TEXT 事件在此之上累加
    chatStore.streamContent = session.contentBuffer
  }

  /**
   * cleanupSession — 清理 session 注册
   */
  function cleanupSession(session: StreamSession) {
    session.isActive = false
    streamSessions.delete(session.convId)
    sendingConvIds.value = new Set(
      [...sendingConvIds.value].filter(id => id !== session.convId)
    )
  }

  /**
   * abort — 真正停止当前对话的流
   *
   * 1. abort fetch（第一层防线）→ HTTP 断开
   * 2. 服务端 req.on('close') → isCancelled=true → 停止 LLM + DB 写入
   * 3. 同步清理 Store 状态（不依赖异步 AbortError 传播）
   * 4. 清理 session 注册
   *
   * 只停止当前对话的流，其他对话的后台流继续运行。
   */
  function abort() {
    const convId = chatStore.currentConvId
    if (!convId) return

    const session = streamSessions.get(convId)
    if (!session?.isActive) return

    // 1. abort fetch（服务端检测到断开 → isCancelled=true → 停止一切）
    session.abortController.abort()

    // 2. 同步清理 Store（不依赖 AbortError 异步传播）
    chatStore.finishStreaming()

    // 3. 清理 session
    session.isActive = false
    streamSessions.delete(convId)
    sendingConvIds.value = new Set(
      [...sendingConvIds.value].filter(id => id !== convId)
    )
  }

  /**
   * switchConversation — 切换对话（唯一入口）
   *
   * - 目标有活跃流 → 恢复实时输出（DB 历史 + buffer 补丁）
   * - 目标无活跃流 → 正常加载 DB 历史
   * - 旧对话的流不中断，继续后台运行
   */
  async function switchConversation(id: string) {
    const activeSession = streamSessions.get(id)

    if (activeSession?.isActive) {
      // 目标有活跃流 → 恢复实时输出
      await restoreStreamSession(id)
      // restoreStreamSession 内部再次检查了 session 是否存活；
      // 如果流恰好在两次检查之间结束，session 会被 cleanupSession 移除，
      // restoreStreamSession 提前 return，此时 currentConvId 未变 → 需要 fallback
      if (chatStore.currentConvId !== id) {
        await chatStore.selectConversation(id)
      }
    } else {
      // 无活跃流 → 正常加载
      await chatStore.selectConversation(id)
    }
  }

  return {
    isSending,
    error,
    /** 调试用：当前活跃流数量 */
    activeStreamCount: computed(() => streamSessions.size),
    sendMessage,
    regenerate,
    abort,
    switchConversation
  }
}
