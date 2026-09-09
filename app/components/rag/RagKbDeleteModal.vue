<script lang="ts" setup>
import type { KnowledgeBase } from '~~/shared/types/rag'

const props = defineProps<{
  open: boolean
  deletingKb: KnowledgeBase | null
}>()

const emit = defineEmits<{
  close: []
}>()

const ragStore = useRagStore()
const toast = useToast()

const deleting = ref(false)

const modalOpen = computed({
  get: () => props.open,
  set: (v: boolean) => { if (!v) emit('close') }
})

async function handleDelete() {
  if (!props.deletingKb) return
  deleting.value = true
  try {
    await ragStore.removeKB(props.deletingKb.id)
    toast.add({ title: '知识库已删除', color: 'success', icon: 'i-lucide-check' })
    emit('close')
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '删除失败'
    toast.add({ title: msg, color: 'error', icon: 'i-lucide-alert-circle' })
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="modalOpen"
    title="删除知识库"
    :ui="{ footer: 'justify-end' }"
  >
    <template #body>
      <div class="flex flex-col items-center text-center gap-4 py-4">
        <div class="w-12 h-12 rounded-full bg-error-500/10 flex items-center justify-center">
          <UIcon
            name="i-lucide-alert-triangle"
            class="w-6 h-6 text-error-500"
          />
        </div>
        <div>
          <p class="text-sm text-default">
            确定要删除知识库
          </p>
          <p class="text-sm font-semibold text-highlighted mt-1">
            "{{ deletingKb?.name }}"
          </p>
          <p class="text-xs text-dimmed mt-2">
            将级联删除其下所有文档与全部向量切片，此操作不可撤销
          </p>
        </div>
      </div>
    </template>

    <template #footer>
      <UButton
        color="neutral"
        variant="ghost"
        @click="emit('close')"
      >
        取消
      </UButton>
      <UButton
        color="error"
        :loading="deleting"
        @click="handleDelete"
      >
        删除
      </UButton>
    </template>
  </UModal>
</template>
