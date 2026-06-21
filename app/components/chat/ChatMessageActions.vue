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
      v-if="role === 'assistant'"
      class="cursor-pointer"
      icon="i-lucide-refresh-cw"
      variant="ghost"
      size="xs"
      color="neutral"
      title="重新生成"
      :disabled="isSending"
      @click="handelRegenerate"
    />
  </div>
</template>

<script lang='ts' setup>
const props = defineProps<{
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
}>()

const { regenerate, isSending } = useChat()

const totast = useToast()
// 复制
function handleCopy() {
  try {
    navigator.clipboard.writeText(props.content)
    totast.add({
      title: '已复制到剪贴板',
      color: 'success',
      icon: 'i-lucide-check'
    })
  } catch (error: any) {
    totast.add({
      title: `复制失败: ${error}`,
      color: 'error'
    })
  }
}

function handelRegenerate() {
  regenerate()
}
</script>
