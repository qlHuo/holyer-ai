import { PROVIDERS } from '~/constants/providers'

/**
 * @Description 全局设置 Store
 */
export const useSettingsStore = defineStore('settings', () => {
  const defaultProvider = ref(PROVIDERS[0]?.id)
  const defaultModel = ref(PROVIDERS[0]?.models[0]?.id)

  const currentProviderModels = computed(() => {
    const provider = PROVIDERS.find(p => p.id === defaultProvider.value)
    return provider?.models || []
  })

  // 切换provider时，自动选择改provider的第一个模型
  function setProvider(providerId: string) {
    defaultProvider.value = providerId
    const provider = PROVIDERS.find(p => p.id === providerId)
    defaultModel.value = provider?.models[0]?.id
  }

  function setModel(modelId: string) {
    defaultModel.value = modelId
  }

  return {
    defaultProvider,
    defaultModel,
    currentProviderModels,
    setProvider,
    setModel
  }
})
