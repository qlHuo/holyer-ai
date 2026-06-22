<script setup lang="ts">
const chatStore = useChatStore()
const { error: chatError } = useChat()
const toast = useToast()

/** 消息列表容器引用（用于自动滚底） */
const messagesContainer = ref<HTMLElement | null>(null)

/** 是否显示欢迎页 */
const showWelcome = computed(() =>
  !chatStore.isStreaming && chatStore.messages.length === 0
)

/** 自动滚动到底部 */
function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}

// 判断指定消息是否为错误状态
function isMessageError(index: number, role: string): boolean {
  // 只有最后一条 assistant 消息可能处于错误状态
  return (
    role === 'assistant'
    && index === chatStore.messages.length - 1
    && !chatStore.isStreaming // 流还在跑 = 不是错误
    && chatStore.streamError !== null // 有错误信息
  )
}

// 监听消息变化，自动滚底
watch(
  () => chatStore.messages.length,
  () => scrollToBottom()
)

// 监听流式内容变化，自动滚底（逐 token 追加时）
watch(
  () => chatStore.streamContent,
  () => scrollToBottom()
)

// 监听流式错误
watch(chatError, (newError) => {
  if (newError) {
    toast.add({
      title: newError || '流式请求失败',
      color: 'error',
      icon: 'i-lucide-alert-circle'
    })
  }
})
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 消息列表区域 -->
    <div
      ref="messagesContainer"
      class="flex-1 overflow-y-auto scroll-smooth"
    >
      <!-- 欢迎页 -->
      <div
        v-if="showWelcome"
        class="flex items-center justify-center h-full"
      >
        <div class="text-center max-w-md px-8">
          <UIcon
            name="i-lucide-sparkles"
            class="w-12 h-12 mx-auto mb-4 text-(--ui-primary)"
          />
          <h2 class="text-xl font-semibold mb-2 text-(--ui-text-highlighted)">
            开始对话
          </h2>
          <p class="text-sm text-(--ui-text-dimmed)">
            在下方选择模型并输入消息，AI 将流式回复你。
          </p>
        </div>
      </div>

      <!-- 消息列表 -->
      <div
        v-else
        class="max-w-3xl mx-auto"
      >
        <ChatMessage
          v-for="(msg, index) in chatStore.messages"
          :key="index"
          :role="msg.role"
          :content="msg.content"
          :is-streaming="index === chatStore.messages.length - 1 && chatStore.isStreaming"
          :has-error="isMessageError(index, msg.role)"
          :is-initializing="index === chatStore.messages.length - 1 && chatStore.isInitializing"
          :show-regenerate="index === chatStore.messages.length - 1"
        />
      </div>
    </div>

    <!-- 底部输入区 -->
    <ChatInput />
  </div>
</template>
