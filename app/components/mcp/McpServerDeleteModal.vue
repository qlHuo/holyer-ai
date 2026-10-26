<script lang="ts" setup>
import type { McpServerSummary } from '~~/shared/types/mcp'

const props = defineProps<{
  open: boolean
  deletingServer: McpServerSummary | null
}>()

const emit = defineEmits<{
  close: []
}>()

const mcpStore = useMcpStore()
const toast = useToast()

const deleting = ref(false)

const modalOpen = computed({
  get: () => props.open,
  set: (v: boolean) => { if (!v) emit('close') }
})

async function handleDelete() {
  if (!props.deletingServer) return
  deleting.value = true
  try {
    await mcpStore.removeServer(props.deletingServer.id)
    toast.add({ title: 'MCP Server 已删除', color: 'success', icon: 'i-lucide-check' })
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
    title="删除 MCP Server"
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
            确定要删除 MCP Server
          </p>
          <p class="text-sm font-semibold text-highlighted mt-1">
            "{{ deletingServer?.name }}"
          </p>
          <p class="text-xs text-dimmed mt-2">
            将同时删除其配置与工具快照；历史消息中的工具调用记录不受影响
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
