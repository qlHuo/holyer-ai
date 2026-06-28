<script lang='ts' setup>
const props = defineProps<{
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  hasError?: boolean
  showRegenerate?: boolean
}>()

// 所有 useChat() 实例共享同一个 isSending
// regenerate 运行时 ChatInput 的停止按钮也能停止它
const { regenerate, isSending } = useChat()

const toast = useToast()

/** 复制消息内容 */
function handleCopy() {
  try {
    navigator.clipboard.writeText(props.content)
    toast.add({
      title: '已复制到剪贴板',
      color: 'success',
      icon: 'i-lucide-check'
    })
  } catch (error: any) {
    toast.add({
      title: `复制失败: ${error}`,
      color: 'error'
    })
  }
}

/** 重新生成 */
function handleRegenerate() {
  regenerate()
}
</script>

<template>
  <div class="flex items-center gap-0.5">
    <UButton
      class="cursor-pointer"
      icon="i-lucide-copy"
      variant="ghost"
      size="xs"
      color="neutral"
      title="复制"
      @click="handleCopy"
    />

    <UButton
      v-if="role === 'assistant' && showRegenerate"
      class="cursor-pointer"
      icon="i-lucide-refresh-cw"
      variant="ghost"
      size="xs"
      :color="hasError ? 'error' : 'neutral'"
      :title="hasError ? '点击重试' : '重新生成'"
      :disabled="isSending"
      @click="handleRegenerate"
    />
  </div>
</template>
