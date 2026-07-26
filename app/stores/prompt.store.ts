/**
 * 提示词管理store
*/
import { ref } from 'vue'
import type { PromptListItem, PromptInput } from '~~/shared/types/prompt'
import PromptApi from '~/api/prompts'

export const usePromptStore = defineStore('prompt', () => {
  const list = ref<Array<PromptListItem>>([])
  const loading = ref(false)
  const loadError = ref<string | null>(null)
  const selectedPromptId = ref<string | null>(null)

  // 获取提示词列表
  async function getList() {
    if (loading.value) return
    loading.value = true
    loadError.value = null
    try {
      const data = await PromptApi.getPromptList()
      list.value = data
      loadError.value = null
    } catch (error: any) {
      loadError.value = error.message
    } finally {
      loading.value = false
    }
  }

  // 创建提示词
  async function create(data: PromptInput) {
    const detail = await PromptApi.createPrompt(data)
    list.value.unshift(detail)
  }

  // 修改提示词
  async function update(id: string, data: PromptInput) {
    const detail = await PromptApi.updatePrompt(id, data)
    if (!detail) return
    list.value = list.value.map(item => item.id === id ? detail : item)
  }

  // 删除提示词
  async function remove(id: string) {
    const result = await PromptApi.deletePrompt(id)
    if (result) {
      list.value = list.value.filter(item => item.id !== id)
    }
  }

  // 获取提示词选项
  const promptOptions = computed(() => {
    return list.value.map(item => ({
      label: item.name,
      value: item.id
    }))
  })

  const selectedPrompt = computed(() => {
    return list.value.find(item => item.id === selectedPromptId.value)
  })

  // 选择提示词
  function handleSelectPrompt(id: string | null) {
    selectedPromptId.value = id
  }

  // 获取已选择的提示词内容(useChat调用时使用)
  function getSelectedPromptContent() {
    return selectedPrompt.value?.prompt
  }

  return {
    list,
    loading,
    loadError,
    promptOptions,
    selectedPromptId,
    selectedPrompt,
    getList,
    create,
    update,
    remove,
    getSelectedPromptContent,
    handleSelectPrompt
  }
})
