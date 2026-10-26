<script lang="ts" setup>
import type { McpServerSummary } from '~~/shared/types/mcp'

const chatStore = useChatStore()
const mcpStore = useMcpStore()
const toast = useToast()

// ==================== 页面初始化 ====================

onMounted(() => {
  chatStore.currentConvId = null
  mcpStore.getServers()
})

// ==================== 表单弹窗 ====================

const formModalOpen = ref(false)
const editingServer = ref<McpServerSummary | null>(null)

function openCreate() {
  editingServer.value = null
  formModalOpen.value = true
}

function openEdit(server: McpServerSummary) {
  editingServer.value = server
  formModalOpen.value = true
}

function closeFormModal() {
  formModalOpen.value = false
}

// ==================== 删除弹窗 ====================

const deleteModalOpen = ref(false)
const deletingServer = ref<McpServerSummary | null>(null)

function openDelete(server: McpServerSummary) {
  deletingServer.value = server
  deleteModalOpen.value = true
}

function closeDeleteModal() {
  deleteModalOpen.value = false
}

// ==================== 启停 / 刷新 / 工具开关 ====================

/** 正在刷新的 Server id（用于卡片 loading） */
const refreshingId = ref<string | null>(null)

async function handleToggleEnabled(server: McpServerSummary, value: boolean) {
  try {
    await mcpStore.patchServer(server.id, { enabled: value })
    toast.add({
      title: value ? `已启用「${server.name}」` : `已停用「${server.name}」`,
      color: 'success',
      icon: 'i-lucide-check'
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '操作失败'
    toast.add({ title: msg, color: 'error', icon: 'i-lucide-alert-circle' })
  }
}

async function handleToggleTool(server: McpServerSummary, toolName: string, enabled: boolean) {
  const nextDisabled = enabled
    ? server.disabledTools.filter(name => name !== toolName)
    : [...server.disabledTools, toolName]

  try {
    await mcpStore.patchServer(server.id, { disabledTools: nextDisabled })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '工具开关保存失败'
    toast.add({ title: msg, color: 'error', icon: 'i-lucide-alert-circle' })
    // 失败时回读服务端状态，避免开关停在错误位置
    await mcpStore.getServers()
  }
}

async function handleRefresh(server: McpServerSummary) {
  refreshingId.value = server.id
  try {
    const { probe } = await mcpStore.refreshServer(server.id)
    if (probe.ok) {
      toast.add({
        title: `已刷新「${server.name}」：${probe.tools?.length ?? 0} 个工具`,
        color: 'success',
        icon: 'i-lucide-check'
      })
    } else {
      toast.add({
        title: probe.error?.message || '刷新失败，已保留旧快照',
        color: 'error',
        icon: 'i-lucide-alert-circle'
      })
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '刷新失败'
    toast.add({ title: msg, color: 'error', icon: 'i-lucide-alert-circle' })
  } finally {
    refreshingId.value = null
  }
}
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- ========== 顶部标题栏 ========== -->
    <div class="shrink-0 flex items-center justify-between gap-3 p-4">
      <div class="flex items-baseline gap-2 min-w-0">
        <div class="flex items-center gap-2">
          <div class="w-6 h-6 rounded-md bg-primary/10 text-primary flex items-center justify-center">
            <UIcon
              name="i-lucide-plug"
              class="w-3.5 h-3.5"
            />
          </div>
          <h1 class="text-lg font-semibold text-highlighted tracking-tight">
            MCP 工具
          </h1>
        </div>
        <span
          v-if="!mcpStore.loading"
          class="text-xs text-dimmed truncate"
        >
          {{ mcpStore.servers.length }} 个 Server
        </span>
      </div>

      <UButton
        icon="i-lucide-plus"
        color="primary"
        class="shrink-0"
        @click="openCreate"
      >
        接入 Server
      </UButton>
    </div>

    <!-- ========== 内容区 ========== -->
    <div class="flex-1 overflow-auto p-4 pt-0">
      <!-- 加载中 -->
      <div
        v-if="mcpStore.loading"
        class="grid grid-cols-1 gap-3 md:gap-4 lg:grid-cols-2 2xl:grid-cols-3"
      >
        <div
          v-for="i in 6"
          :key="i"
          class="rounded-lg border border-default p-3.5 md:p-4 space-y-3"
          :class="{ 'hidden lg:block': i >= 3 && i <= 4, 'hidden 2xl:block': i >= 5 }"
        >
          <USkeleton class="h-5 w-2/3" />
          <USkeleton class="h-4 w-full" />
          <USkeleton class="h-4 w-4/5" />
          <USkeleton class="h-8 w-full" />
        </div>
      </div>

      <!-- 加载失败 -->
      <div
        v-else-if="mcpStore.loadError"
        class="flex flex-col items-center justify-center py-20 text-dimmed gap-3"
      >
        <UIcon
          name="i-lucide-alert-circle"
          class="w-10 h-10 text-error-500"
        />
        <p class="text-sm text-error-500">
          {{ mcpStore.loadError }}
        </p>
        <UButton
          size="sm"
          color="error"
          variant="outline"
          icon="i-lucide-refresh-cw"
          @click="mcpStore.getServers()"
        >
          重试
        </UButton>
      </div>

      <!-- 空状态 -->
      <div
        v-else-if="mcpStore.servers.length === 0"
        class="flex flex-col items-center justify-center py-16 sm:py-20 text-dimmed gap-3"
      >
        <UIcon
          name="i-lucide-plug"
          class="w-8 sm:w-10 h-8 sm:h-10 opacity-25"
        />
        <p class="text-sm">
          还没有接入 MCP Server
        </p>
        <p class="text-xs text-dimmed/70 text-center max-w-sm">
          填写 MCP 端点地址并测试连接，即可把外部工具接入对话
        </p>
        <UButton
          size="sm"
          color="primary"
          variant="outline"
          icon="i-lucide-plus"
          class="mt-2"
          @click="openCreate"
        >
          接入 Server
        </UButton>
      </div>

      <!-- 卡片网格 -->
      <div
        v-else
        class="grid grid-cols-1 gap-2 md:gap-3 lg:grid-cols-2 lg:gap-4 2xl:grid-cols-3"
      >
        <McpServerCard
          v-for="server in mcpStore.servers"
          :key="server.id"
          :server="server"
          :refreshing="refreshingId === server.id"
          @edit="openEdit"
          @delete="openDelete"
          @refresh="handleRefresh"
          @toggle-enabled="handleToggleEnabled"
          @toggle-tool="handleToggleTool"
        />
      </div>
    </div>

    <!-- ========== 创建/编辑弹窗 ========== -->
    <McpServerFormModal
      :open="formModalOpen"
      :editing-server="editingServer"
      @close="closeFormModal"
    />

    <!-- ========== 删除确认弹窗 ========== -->
    <McpServerDeleteModal
      :open="deleteModalOpen"
      :deleting-server="deletingServer"
      @close="closeDeleteModal"
    />
  </div>
</template>
