<script lang="ts" setup>
import type { PromptListItem } from '~~/shared/types/prompt'

const props = defineProps<{
  open: boolean
  prompting: PromptListItem | null
}>()

const emit = defineEmits<{
  close: []
}>()

const promptStore = usePromptStore()
const toast = useToast()

const deleting = ref(false)

const modalOpen = computed({
  get: () => props.open,
  set: (v: boolean) => { if (!v) emit('close') }
})

async function handleDelete() {
  if (!props.prompting) return
  deleting.value = true
  try {
    await promptStore.remove(props.prompting.id)
    toast.add({ title: '提示词已删除', color: 'success', icon: 'i-lucide-check' })
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
    title="删除提示词"
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
          <p class="text-sm text-(--ui-text)">
            确定要删除提示词
          </p>
          <p class="text-sm font-semibold text-(--ui-text-highlighted) mt-1">
            "{{ prompting?.name }}"
          </p>
          <p class="text-xs text-(--ui-text-dimmed) mt-2">
            此操作不可撤销
          </p>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
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
      </div>
    </template>
  </UModal>
</template>
