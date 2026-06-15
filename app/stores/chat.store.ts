/**
 * @Description 聊天状态Store
 *
 * 1. 管理对话列表（加载、创建、删除）
 * 2. 管理当前对话的消息列表
 * 3. 管理流式接收状态（isStreaming, streamContent）
 * 4. 管理当前选中的Provider/Model
 *
 * 不负责SSE连接本身，只维护相关状态
 */

import type { Message } from '#shared/types/provider'
import type { ConversationDetail, ConversationListItem } from '#shared/types/conversation'

export const useChatStore = defineStore('chat', () => {
  // 会话
  const conversations = ref<ConversationListItem[]>([])
  const currentConvId = ref<string | null>(null)
  const listLoading = ref(false)

  // 消息
  const messages = ref<Message[]>([])
  const isStreaming = ref(false)
  const streamContent = ref('')

  // 模型
  const selectProvider = ref('deepseek')
  const selectModel = ref('deepseek-v4-flash')

  // 当前会话信息
  const currentConversation = computed(() =>
    conversations.value.find(con => con.id === currentConvId.value) || null
  )

  const hasMessages = computed(() => messages.value.length > 0)

  // 加载对话列表
  async function loadConversations() {
    listLoading.value = true
    try {
      const data = await $fetch<ConversationListItem[]>('/api/conversations')
      conversations.value = data
    } catch (error) {
      console.error('加载对话列表失败：', error)
    } finally {
      listLoading.value = false
    }
  }

  // 获取选中对话的历史消息
  async function selectConversation(id: string) {
    if (currentConvId.value === id) return

    currentConvId.value = id
    messages.value = []
    streamContent.value = ''

    try {
      const data = await $fetch<ConversationDetail>(`/api/conversations/${id}`)
      messages.value = data.messages
      selectModel.value = data.provider
      selectModel.value = data.model
    } catch (error) {
      console.error('加载对话详情失败：', error)
    }
  }

  // 创建新对话
  async function createConversation(provider?: string, model?: string) {
    const p = provider || selectProvider.value
    const m = model || selectModel.value

    try {
      const data = await $fetch<ConversationDetail>('/api/conversations', {
        method: 'POST',
        body: { provider: p, model: m }
      })

      conversations.value.unshift({
        id: data.id,
        title: data.title,
        model: data.model,
        provider: data.provider,
        messageCount: 0,
        lastPreview: null,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt
      })

      // 切换到新对话
      currentConvId.value = data.id
      messages.value = []
      streamContent.value = ''
      selectProvider.value = p
      selectModel.value = m
    } catch (error) {
      console.error('创建对话失败：', error)
    }
  }

  // 删除对话
  async function deleteConversation(id: string) {
    try {
      await $fetch(`/api/conversations/${id}`, {
        method: 'DELETE'
      })
      conversations.value = conversations.value.filter(c => c.id !== id)
      if (currentConvId.value === id) {
        currentConvId.value = null
        messages.value = []
      }
    } catch (error) {
      console.error('删除对话失败', error)
    }
  }

  // ------消息操作---------
  // 添加消息到列表（用户消息、assistant完整消息）
  function addMessage(msg: Message) {
    messages.value.push(msg)
  }

  // 开始流式接收消息,先添加一个空的assistant占位消息
  function startStreaming() {
    isStreaming.value = true
    streamContent.value = ''
    messages.value.push({ role: 'assistant', content: '' })
  }

  // 追加流式内容 -- 更新占位消息的content
  function appendStreamContent(chunk: string) {
    streamContent.value += chunk
    // 找到最后一条 assistant 消息并更新
    const lastMsg = messages.value[messages.value.length - 1]
    if (lastMsg && lastMsg.role === 'assistant') {
      lastMsg.content = streamContent.value
    }
  }

  // 结束流式接收
  function finishStreaming() {
    isStreaming.value = false
    streamContent.value = ''
  }

  // 处理新对话的 conversationId (SSE meta 事件返回)
  function setCurrentConvId(id: string) {
    currentConvId.value = id
    // 更新或者添加到对话列表
    const existing = conversations.value.find(c => c.id === id)
    if (!existing) {
      conversations.value.unshift({
        id,
        title: '新对话',
        model: selectModel.value,
        provider: selectProvider.value,
        messageCount: 0,
        lastPreview: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
    }
  }

  // 更新对话列表项（流结束后刷新标题和预览）
  function updateConversationItem(id: string, updates: Partial<ConversationListItem>) {
    const index = conversations.value.findIndex(c => c.id === id)
    if (index !== -1) {
      conversations.value[index] = { ...conversations.value[index], ...updates } as ConversationListItem
    }
  }

  // -----Provider/Model 选择-----
  function setProvider(providerId: string) {
    selectProvider.value = providerId
  }

  function setModel(modelId: string) {
    selectModel.value = modelId
  }

  // 开启新对话（清空currentId 和消息）
  function startNewChat() {
    currentConvId.value = null
    messages.value = []
    streamContent.value = ''
    isStreaming.value = false
  }

  return {
    conversations,
    currentConvId,
    listLoading,
    messages,
    isStreaming,
    streamContent,
    selectProvider,
    selectModel,
    currentConversation,
    hasMessages,
    loadConversations,
    selectConversation,
    createConversation,
    deleteConversation,
    addMessage,
    startStreaming,
    appendStreamContent,
    finishStreaming,
    setCurrentConvId,
    updateConversationItem,
    setProvider,
    setModel,
    startNewChat
  }
})
