<script setup lang="ts">
const chatStore = useChatStore()
// useChat 是模块级单例，多次调用安全
const { error: chatError } = useChat()
const toast = useToast()

/** 消息列表容器引用（用于自动滚底） */
const messagesContainer = ref<HTMLElement | null>(null)

/** 是否显示欢迎页（排除 API 加载中的短暂空态） */
const showWelcome = computed(() =>
  !chatStore.isStreaming && !chatStore.messagesLoading && chatStore.messages.length === 0
)

/** 自动滚动到底部 */
function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}

/** 判断指定消息是否为错误状态 */
function isMessageError(index: number, role: string): boolean {
  return (
    role === 'assistant'
    && index === chatStore.messages.length - 1
    && !chatStore.isStreaming
    && chatStore.streamError !== null
  )
}

// 监听消息变化，自动滚底
watch(
  () => chatStore.messages.length,
  () => scrollToBottom()
)

// 监听流式内容变化，自动滚底
watch(
  () => chatStore.streamContent,
  () => scrollToBottom()
)

// 监听流式错误 → toast 提示
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
      <!-- 消息加载骨架屏 -->
      <div
        v-if="chatStore.messagesLoading"
        class="flex-1 overflow-y-auto"
      >
        <div class="max-w-3xl mx-auto py-4">
          <!-- 骨架消息 1：用户消息（右对齐，短） -->
          <div class="flex flex-col py-4 px-4">
            <div class="flex gap-3 flex-row-reverse">
              <USkeleton class="w-8 h-8 rounded-full shrink-0" />
              <USkeleton class="h-10 rounded-lg max-w-[45%] w-full" />
            </div>
          </div>

          <!-- 骨架消息 2：助手消息（左对齐，中长） -->
          <div class="flex flex-col py-4 px-4">
            <div class="flex gap-3">
              <USkeleton class="w-8 h-8 rounded-full shrink-0" />
              <USkeleton class="h-20 rounded-lg max-w-[65%] w-full" />
            </div>
          </div>

          <!-- 骨架消息 3：用户消息（右对齐，中） -->
          <div class="flex flex-col py-4 px-4">
            <div class="flex gap-3 flex-row-reverse">
              <USkeleton class="w-8 h-8 rounded-full shrink-0" />
              <USkeleton class="h-14 rounded-lg max-w-[55%] w-full" />
            </div>
          </div>

          <!-- 骨架消息 4：助手消息（左对齐，最长） -->
          <div class="flex flex-col py-4 px-4">
            <div class="flex gap-3">
              <USkeleton class="w-8 h-8 rounded-full shrink-0" />
              <USkeleton class="h-24 rounded-lg max-w-[70%] w-full" />
            </div>
          </div>
        </div>
      </div>

      <!-- 欢迎页 -->
      <div
        v-else-if="showWelcome"
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
