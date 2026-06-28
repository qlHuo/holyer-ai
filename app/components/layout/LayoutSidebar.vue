<script setup lang="ts">
defineProps({
  /** 移动端是否显示（slideover 模式） */
  modelValue: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['update:modelValue', 'close'])

const { switchConversation } = useChat()
const chatStore = useChatStore()
const toast = useToast()

/** 确认删除的对话 ID */
const deletingId = ref<string | null>(null)

/** 列表加载错误（null = 无错误） */
const loadError = ref<string | null>(null)

/** 删除确认弹窗是否显示 */
const showDeleteModal = computed({
  get: () => deletingId.value !== null,
  set: (v) => { if (!v) deletingId.value = null }
})

/** 新建对话 */
async function handleCreate() {
  try {
    // 若有空对话则切换到该对话，否则新建
    const emptyConv = chatStore.conversations.find(conv => conv.messageCount === 0)
    if (emptyConv) {
      await switchConversation(emptyConv.id)
      emit('close')
      return
    }
    await chatStore.createConversation()
    emit('close')
  } catch (error: any) {
    toast.add({ title: error || '新建对话失败', color: 'error', icon: 'i-lucide-alert-circle' })
  }
}

/** 选中对话 */
function handleSelect(id: string) {
  try {
    switchConversation(id)
    emit('close')
  } catch (error: any) {
    toast.add({ title: error || '切换对话失败', color: 'error', icon: 'i-lucide-alert-circle' })
  }
}

/** 确认删除 */
async function handleDelete() {
  if (!deletingId.value) return
  try {
    await chatStore.deleteConversation(deletingId.value)
    deletingId.value = null
  } catch (error: any) {
    toast.add({ title: error || '删除对话失败', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

/** 格式化时间为相对时间 */
function formatTime(isoStr: string): string {
  const date = new Date(isoStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (hours < 24) return `${hours} 小时前`
  if (days < 7) return `${days} 天前`
  return date.toLocaleDateString('zh-CN')
}

/** 重试加载对话列表 */
async function retryLoad() {
  loadError.value = null
  try {
    await chatStore.loadConversations()
  } catch (error: any) {
    loadError.value = error?.message || '加载对话列表失败'
  }
}

// 组件挂载时加载对话列表
onMounted(() => {
  retryLoad()
})
</script>

<template>
  <!-- ===== 侧边栏内容（桌面端和移动端共用） ===== -->
  <div class="flex flex-col h-full bg-(--ui-bg-elevated)">
    <!-- 顶部：新建按钮 -->
    <div class="p-3 border-b border-(--ui-border)">
      <UButton
        block
        icon="i-lucide-plus"
        color="primary"
        @click="handleCreate"
      >
        新建对话
      </UButton>
    </div>

    <!-- 中间：对话列表 -->
    <div class="flex-1 overflow-y-auto">
      <!-- 加载中 -->
      <div v-if="chatStore.listLoading" class="flex items-center justify-center py-12 gap-2">
        <UIcon name="i-lucide-loader" class="w-5 h-5 animate-spin text-(--ui-text-dimmed)" />
        <span class="text-sm text-(--ui-text-dimmed)">加载中…</span>
      </div>

      <!-- 加载失败 -->
      <div
        v-else-if="loadError && chatStore.conversations.length === 0"
        class="p-6 text-center"
      >
        <UIcon
          name="i-lucide-alert-circle"
          class="w-8 h-8 mx-auto mb-2 text-(--ui-color-error-400)"
        />
        <p class="text-sm text-(--ui-color-error-500) mb-3">
          {{ loadError }}
        </p>
        <UButton
          size="xs"
          color="error"
          variant="outline"
          icon="i-lucide-refresh-cw"
          @click="retryLoad"
        >
          重试
        </UButton>
      </div>

      <!-- 空状态 -->
      <div
        v-else-if="chatStore.conversations.length === 0"
        class="p-6 text-center"
      >
        <p class="text-sm text-(--ui-text-dimmed)">
          暂无对话
        </p>
        <p class="text-xs text-(--ui-text-dimmed) mt-1">
          点击上方按钮创建
        </p>
      </div>

      <!-- 对话列表项 -->
      <div
        v-for="conv in chatStore.conversations"
        v-else
        :key="conv.id"
        class="group relative mx-2 mt-1 rounded-lg cursor-pointer transition-colors"
        :class="chatStore.currentConvId === conv.id
          ? 'bg-(--ui-primary)/10 text-(--ui-primary)'
          : 'hover:bg-(--ui-bg) text-(--ui-text)'"
        @click="handleSelect(conv.id)"
      >
        <div class="px-3 py-2.5">
          <!-- 标题 + 删除按钮 -->
          <div class="h-6 flex items-center justify-between gap-1">
            <p class="text-sm font-medium truncate flex-1">
              {{ conv.title }}
            </p>
            <UButton
              icon="i-lucide-trash"
              variant="ghost"
              size="xs"
              color="error"
              class="shrink-0 hidden group-hover:block"
              @click.stop="deletingId = conv.id"
            />
          </div>
          <!-- 预览 + 时间 -->
          <div class="flex items-center justify-between mt-1 gap-2">
            <p class="text-xs text-(--ui-text-dimmed) truncate flex-1">
              {{ conv.lastPreview || '暂无消息' }}
            </p>
            <span class="text-xs text-(--ui-text-dimmed) shrink-0">
              {{ formatTime(conv.updatedAt) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部：Provider/Model 信息 -->
    <div
      v-if="chatStore.currentConversation"
      class="p-3 border-t border-(--ui-border)"
    >
      <p class="text-xs text-(--ui-text-dimmed)">
        {{ chatStore.currentConversation.provider }} / {{ chatStore.currentConversation.model }}
      </p>
    </div>

    <!-- ===== 删除确认弹窗 ===== -->
    <UModal
      v-model:open="showDeleteModal"
      title="删除对话"
    >
      <template #body>
        <p class="text-sm text-(--ui-text)">
          确定要删除这个对话吗？对话中的所有消息也会被删除，此操作不可撤销。
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="deletingId = null"
          >
            取消
          </UButton>
          <UButton
            color="error"
            @click="handleDelete"
          >
            删除
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
