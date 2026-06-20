// SSE消费核心代码
import type { Message } from '#shared/types/provider'
import type { ConversationDetail } from '#shared/types/conversation'
import { extractSSEField } from '~/utils/sse'
import { SSE_EVENT } from '~~/shared/types/sse'

/**
 * SSE 流式聊天
 *
 * 1. 构建请求体并发送 POST /api/chat
 * 2. 解析 SSE 事件流
 * 3. 按照事件类型分发到chatStore
 * 4. 支持 AbortController 中断
 *
 * 设计决策：
 * - abortController 是 composable 内部状态，不需要全局共享
 * - 通过 chatStore 间接更新 UI，composable 不直接操作 DOM
*/
export function useChat() {
  const chatStore = useChatStore()

  // 当前请求的 AbortController 用于中断对话
  let abortController: AbortController | null = null

  // 是否有进行中的请求
  const isSending = ref(false)

  const error = ref<string | null>(null)

  /**
   * @Description 发送消息并接口流式响应
   * @params content 用户输入的文本
   */
  async function sendMessage(content: string) {
    if (isSending.value || !content.trim()) return

    // 1. 构造用户消息
    const userMessage: Message = { role: 'user', content: content.trim() }

    // 2. 立即添加用户消息到列表
    chatStore.addMessage(userMessage)

    // 3. 开始流式状态
    chatStore.startStreaming()
    isSending.value = true
    error.value = null

    // 4. 创建 AbortController
    abortController = new AbortController()

    try {
      // 发起 sse 请求
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: chatStore.selectedProvider,
          model: chatStore.selectedModel,
          message: [userMessage],
          conversationId: chatStore.currentConvId
        }),
        signal: abortController.signal
      })

      if (!response.ok) {
        throw new Error(`请求失败： ${response.status} ${response.statusText}`)
      }

      // 6. 读取流
      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error(`无法读取响应流`)
      }

      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        // 解码字节
        buffer += decoder.decode(value, { stream: true })

        // 按 \n\n 分割 SSE chunk
        const frames = buffer.split('\n\n')
        buffer = frames.pop() || ''

        // 处理每一个完整帧
        for (const frame of frames) {
          if (!frame.trim()) continue

          // SSE 帧格式： 有可能 event: xxx + data: xxx行
          const eventType = extractSSEField(frame, 'event')
          const data = extractSSEField(frame, 'data')

          if (!data) continue

          if (eventType === SSE_EVENT.PING) continue

          try {
            const payload = JSON.parse(data)
            handleSSEEvent(payload)
          } catch (error) {
            console.error(error)
          }
        }
      }
    } catch (err: any) {
      // 用户主动中断
      if (err.name === 'AbortError') {
        chatStore.finishStreaming()
      } else {
        error.value = err.message || '请求失败'
        chatStore.finishStreaming()

        // 移除空的 assistant 占位消息
        const lastMsg = chatStore.messages[chatStore.messages.length - 1]
        if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.content) {
          chatStore.messages.pop()
        }
      }
    } finally {
      isSending.value = false
      abortController = null
    }
  }

  /**
   * 分发 SSE 事件
   *
   * 后端事件类型
   * - meta:   { type: 'meta', conversationId: string }
   * - text:   { type: 'text', content: string }
   * - done:   { type: 'done', conversationId: string }
   * - error:   { type: 'error', content: string }
  */
  function handleSSEEvent(payload: { type: string, [key: string]: any }) {
    switch (payload.type) {
      case SSE_EVENT.META:
        // 如果之前没有 conversationId 新对话 后端会返回新的
        if (payload.conversationId && !chatStore.currentConvId) {
          chatStore.setCurrentConvId(payload.conversationId)
        }
        break

      case SSE_EVENT.TEXT:
        if (payload.content) {
          chatStore.appendStreamContent(payload.content)
        }
        break

      case SSE_EVENT.DONE:
        chatStore.finishStreaming()
        // 流式结束后更新对话列表
        if (payload.conversationId) {
          refreshConversationInList(payload.conversationId)
        }
        break

      case SSE_EVENT.ERROR:
        error.value = payload.content || '未知错误'
        chatStore.finishStreaming()
        break

      default:
        break
    }
  }

  // 流式结束后刷新列表中的对话项
  async function refreshConversationInList(id: string) {
    try {
      const data = await $fetch<ConversationDetail>(`/api/conversations/${id}`)
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

  // 中断当前请求
  function abort() {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
  }

  return {
    isSending,
    error,
    sendMessage,
    abort
  }
}
