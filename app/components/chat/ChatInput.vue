<script setup lang="ts">
// useChat() 现在是模块级单例，多次调用返回的是同一份状态的视图
const { isSending, sendMessage, abort } = useChat()

/** 输入内容 */
const input = ref('')

/** 是否可以发送 */
const canSend = computed(() => input.value.trim().length > 0 && !isSending.value)

/** 发送消息 */
async function handleSend() {
  if (!canSend.value) return

  const content = input.value
  input.value = ''
  await sendMessage(content)
}

/** 键盘事件：Enter 发送，Shift+Enter 换行 */
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

/** 中断生成 */
function handleStop() {
  abort()
}
</script>

<template>
  <div class="border-t border-(--ui-border) bg-(--ui-bg) p-4">
    <div class="max-w-3xl mx-auto">
      <!-- 模型选择器（输入框上方） -->
      <div class="mb-2">
        <ChatModelSelector />
      </div>

      <!-- 输入区域 -->
      <div class="flex items-end gap-2">
        <textarea
          v-model="input"
          :disabled="isSending"
          rows="1"
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          class="flex-1 resize-none rounded-lg border border-(--ui-border) bg-(--ui-bg) px-4 py-2.5 text-sm
                 placeholder:text-(--ui-text-dimmed) focus:outline-none focus:ring-2 focus:ring-(--ui-primary)
                 disabled:opacity-50"
          :class="isSending ? 'cursor-not-allowed' : ''"
          @keydown="handleKeydown"
        />

        <!-- 发送 / 停止按钮 -->
        <!-- isSending 是模块级单例，停止按钮可以停止任何流（包括 regenerate） -->
        <UButton
          v-if="isSending"
          icon="i-lucide-square"
          color="neutral"
          variant="soft"
          size="sm"
          class="shrink-0"
          @click="handleStop"
        >
          停止
        </UButton>
        <UButton
          v-else
          icon="i-lucide-send"
          color="primary"
          size="sm"
          class="shrink-0"
          :disabled="!canSend"
          @click="handleSend"
        >
          发送
        </UButton>
      </div>
    </div>
  </div>
</template>
