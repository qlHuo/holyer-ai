/**
 * @Description 聊天状态 Store
 *
 * - selectConversation 支持 skipLoad + presetMessages（后台流恢复）
 * - 保留 streamingConvId 校验作为最后防线
 * - 所有状态变更都有明确的 convId 上下文
 *
 * 1. 管理对话列表（加载、创建、删除）
 * 2. 管理当前对话的消息列表
 * 3. 管理流式接收状态（isStreaming, streamContent）
 * 4. 管理当前选中的 Provider/Model
 *
 * 不负责 SSE 连接本身，只维护相关状态
 */

import type { Message } from '#shared/types/provider'
import type { ConversationListItem } from '#shared/types/conversation'
import ConversationApi from '~/api/conversations'

/** selectConversation 的可选参数 */
interface SelectConversationOptions {
  /** 跳过 DB 加载（由调用方提供消息列表） */
  skipLoad?: boolean
  /** 预设消息列表（skipLoad 为 true 时使用） */
  presetMessages?: Message[]
  /** 预设 provider（skipLoad 为 true 时使用） */
  presetProvider?: string
  /** 预设 model（skipLoad 为 true 时使用） */
  presetModel?: string
}

export const useChatStore = defineStore('chat', () => {
  // ==================== 会话 ====================
  const conversations = ref<ConversationListItem[]>([])
  const currentConvId = ref<string | null>(null)
  const listLoading = ref(false)

  // ==================== 消息 ====================
  const messages = ref<Message[]>([])
  const messagesLoading = ref(false)
  const isStreaming = ref(false)
  const isInitializing = ref(false)
  const streamContent = ref('')

  /**
   * 正在流的对话 ID（null 表示尚未分配 ID 的新对话）
   *
   * 这是第三层防线（防御性编程）：
   * - 第一层：abort() → fetch 取消
   * - 第二层：consumeSSEStream 内 aborted 标志检查
   * - 第三层：appendStreamContent 时校验 convId（本防线）
   */
  const streamingConvId = ref<string | null>(null)

  // ==================== 模型选择 ====================
  const selectedProvider = ref('deepseek')
  const selectedModel = ref('deepseek-v4-flash')

  /** 当前流式请求的错误信息（null = 无错误） */
  const streamError = ref<string | null>(null)

  // ==================== 计算属性 ====================
  const currentConversation = computed(() =>
    conversations.value.find(con => con.id === currentConvId.value) || null
  )

  const hasMessages = computed(() => messages.value.length > 0)

  // ==================== 对话操作 ====================

  /** 加载对话列表 */
  async function loadConversations() {
    listLoading.value = true
    try {
      const data = await ConversationApi.getList()
      conversations.value = data
    } finally {
      listLoading.value = false
    }
  }

  /**
   * 获取选中对话的历史消息
   *
   * @param id              对话 ID
   * @param opts            可选参数（后台流恢复场景使用）
   *   - skipLoad: true 时跳过 DB 加载，直接使用 presetMessages
   *   - presetMessages: 预设消息列表
   *   - presetProvider / presetModel: 预设模型信息
   */
  async function selectConversation(
    id: string,
    opts?: SelectConversationOptions
  ) {
    if (currentConvId.value === id && !opts?.skipLoad) return

    currentConvId.value = id
    streamContent.value = ''
    streamError.value = null
    isInitializing.value = false

    if (opts?.skipLoad && opts.presetMessages) {
      // 后台流恢复场景：跳过 DB 加载，直接注入消息
      messages.value = opts.presetMessages
      if (opts.presetProvider) selectedProvider.value = opts.presetProvider
      if (opts.presetModel) selectedModel.value = opts.presetModel
      // 恢复流式状态
      isStreaming.value = true
      streamingConvId.value = id
    } else {
      // 正常场景：从 DB 加载
      messagesLoading.value = true
      const loadingConvId = id
      try {
        messages.value = []
        const data = await ConversationApi.getDetailById(id)
        // 快速切换竞态防护：只有仍在加载同一对话时才应用结果
        if (currentConvId.value !== loadingConvId) return
        messages.value = data.messages
        selectedProvider.value = data.provider
        selectedModel.value = data.model
      } finally {
        // 只有仍在加载同一对话时才清除 loading（防止覆盖新对话的 loading）
        if (currentConvId.value === loadingConvId) {
          messagesLoading.value = false
        }
      }
    }
  }

  /** 创建新对话 */
  async function createConversation(provider?: string, model?: string) {
    const p = provider || selectedProvider.value
    const m = model || selectedModel.value

    const data = await ConversationApi.create({ model: m, provider: p })

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
    selectedProvider.value = p
    selectedModel.value = m
    isInitializing.value = false
  }

  /** 删除对话 */
  async function deleteConversation(id: string) {
    await ConversationApi.deleteById(id)
    conversations.value = conversations.value.filter(c => c.id !== id)
    if (currentConvId.value === id) {
      currentConvId.value = null
      messages.value = []
      streamContent.value = ''
      streamError.value = null
      isStreaming.value = false
      isInitializing.value = false
    }
  }

  // ==================== 消息操作 ====================

  /** 添加消息到列表 */
  function addMessage(msg: Message) {
    messages.value.push(msg)
  }

  /**
   * 开始流式接收消息
   *
   * 行为：
   * - 设置 isStreaming, isInitializing
   * - 清空 streamError（新流开始时重置错误态）
   * - 记录 streamingConvId（第三层防线）
   * - 插入空 assistant 占位消息
   */
  function startStreaming() {
    isStreaming.value = true
    streamContent.value = ''
    streamError.value = null
    streamingConvId.value = currentConvId.value
    messages.value.push({ role: 'assistant', content: '' })
    isInitializing.value = true
  }

  /**
   * 追加流式内容 — 更新占位消息的 content
   *
   * ★ 第三层防线：streamingConvId 校验
   * 如果 chunk 不属于当前对话，直接丢弃。
   * 正常情况下不应该走到这里（consumeSSEStream 的 aborted 检查已拦截），
   * 但保留此防线作为深度防御。
   */
  function appendStreamContent(chunk: string) {
    // 第三层防线：chunk 不属于当前对话 → 丢弃
    if (streamingConvId.value !== currentConvId.value) return

    isInitializing.value = false
    streamContent.value += chunk

    const lastMsg = messages.value[messages.value.length - 1]
    if (lastMsg && lastMsg.role === 'assistant') {
      lastMsg.content = streamContent.value
    }
  }

  /**
   * 结束流式接收
   *
   * 清空流式状态。注意：不在这里清 streamError ——
   * streamError 只在 startStreaming / selectConversation / DONE 事件时清空，
   * 确保错误态持续到下一个动作。
   */
  function finishStreaming() {
    isInitializing.value = false
    isStreaming.value = false
    streamContent.value = ''
    streamingConvId.value = null
  }

  /**
   * 处理新对话的 conversationId（SSE META 事件返回）
   *
   * Path B 场景：新建对话流式接收中，META 事件分配了真正的 ID。
   * 同步 streamingConvId，否则 appendStreamContent 的校验会拒绝后续 chunk。
   */
  function setCurrentConvId(id: string, title?: string) {
    currentConvId.value = id

    // Path B 桥接：null → 真实 ID
    if (isStreaming.value && streamingConvId.value === null) {
      streamingConvId.value = id
    }

    // 添加到列表（如果不存在）
    const existing = conversations.value.find(c => c.id === id)
    if (!existing) {
      conversations.value.unshift({
        id,
        title: title || '新对话',
        model: selectedModel.value,
        provider: selectedProvider.value,
        messageCount: 0,
        lastPreview: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
    }
  }

  /** 更新对话列表项（流结束后刷新标题和预览） */
  function updateConversationItem(id: string, updates: Partial<ConversationListItem>) {
    const index = conversations.value.findIndex(c => c.id === id)
    if (index !== -1) {
      conversations.value[index] = {
        ...conversations.value[index],
        ...updates
      } as ConversationListItem
    }
  }

  // ==================== Provider/Model 选择 ====================

  function setProvider(providerId: string) {
    selectedProvider.value = providerId
  }

  function setModel(modelId: string) {
    selectedModel.value = modelId
  }

  /**
   * 开启新对话（清空 currentId 和消息）
   *
   * 注意：不 abort 正在进行的流 —— 如果旧对话有活跃流，
   * 它应该在 streamSessions 中继续运行（后台流保持）。
   * 只有用户明确点"停止"才 abort。
   */
  function startNewChat() {
    currentConvId.value = null
    messages.value = []
    streamContent.value = ''
    streamError.value = null
    isStreaming.value = false
    isInitializing.value = false
    streamingConvId.value = null
  }

  return {
    // 状态
    conversations,
    currentConvId,
    listLoading,
    messagesLoading,
    messages,
    isStreaming,
    isInitializing,
    streamContent,
    streamingConvId,
    selectedProvider,
    selectedModel,
    currentConversation,
    hasMessages,
    streamError,
    // 对话操作
    loadConversations,
    selectConversation,
    createConversation,
    deleteConversation,
    // 消息操作
    addMessage,
    startStreaming,
    appendStreamContent,
    finishStreaming,
    setCurrentConvId,
    updateConversationItem,
    // 模型选择
    setProvider,
    setModel,
    // 新对话
    startNewChat
  }
})
