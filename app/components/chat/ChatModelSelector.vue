<script setup>
import { MODELS } from '~/constants/models'

const chatStore = useChatStore()

const modelOptions = computed(() => {
  return (MODELS || []).map(m => ({
    label: m.name,
    value: m.id
  }))
})

/** 切换 Model */
function onModelChange(modelId) {
  chatStore.setModel(modelId)
}
</script>

<template>
  <div class="flex items-center gap-2">
    <!-- Model 选择器 -->
    <USelect
      :model-value="chatStore.selectedModel"
      :items="modelOptions"
      placeholder="选择模型"
      size="xs"
      color="neutral"
      variant="soft"
      @update:model-value="onModelChange"
    />
  </div>
</template>
