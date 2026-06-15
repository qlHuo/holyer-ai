<script setup>
import { PROVIDERS } from '~/constants/providers'

const chatStore = useChatStore()

/** 所有 Provider 选项 */
const providerOptions = PROVIDERS.map(p => ({
  label: p.name,
  value: p.id
}))

/** 当前 Provider 下的模型选项 */
const modelOptions = computed(() => {
  const provider = PROVIDERS.find(p => p.id === chatStore.selectedProvider)
  return (provider?.models || []).map(m => ({
    label: m.name,
    value: m.id
  }))
})

/** 切换 Provider */
function onProviderChange(providerId) {
  chatStore.setProvider(providerId)
  // 自动选该 Provider 的第一个模型
  const provider = PROVIDERS.find(p => p.id === providerId)
  if (provider && provider.models.length > 0) {
    chatStore.setModel(provider.models[0].id)
  }
}

/** 切换 Model */
function onModelChange(modelId) {
  chatStore.setModel(modelId)
}
</script>

<template>
  <div class="flex items-center gap-2">
    <!-- Provider 选择器 -->
    <USelect
      :model-value="chatStore.selectedProvider"
      :items="providerOptions"
      placeholder="选择提供商"
      size="xs"
      color="neutral"
      variant="soft"
      @update:model-value="onProviderChange"
    />

    <span class="text-(--ui-text-dimmed) text-xs">/</span>

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
