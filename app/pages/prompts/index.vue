<script lang="ts" setup>
import type { PromptListItem } from '~~/shared/types/prompt'

const chatStore = useChatStore()
const promptStore = usePromptStore()

// ==================== 页面初始化 ====================

onMounted(() => {
  chatStore.currentConvId = null
  promptStore.getList()
})

// ==================== 表单弹窗控制 ====================

const formModalOpen = ref(false)
const editingPrompt = ref<PromptListItem | null>(null)

function openCreate() {
  editingPrompt.value = null
  formModalOpen.value = true
}

function openEdit(p: PromptListItem) {
  editingPrompt.value = p
  formModalOpen.value = true
}

function closeFormModal() {
  formModalOpen.value = false
}

// ==================== 删除弹窗控制 ====================

const deleteModalOpen = ref(false)
const deletingPrompt = ref<PromptListItem | null>(null)

function openDelete(p: PromptListItem) {
  deletingPrompt.value = p
  deleteModalOpen.value = true
}

function closeDeleteModal() {
  deleteModalOpen.value = false
}
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- ========== 顶部标题栏 ========== -->
    <div class="shrink-0 flex items-center justify-between p-4">
      <UButton
        icon="i-lucide-plus"
        color="primary"
        @click="openCreate"
      >
        新建提示词
      </UButton>
    </div>

    <!-- ========== 内容区 ========== -->
    <div class="flex-1 overflow-auto p-4 pt-0">
      <!-- 加载中 -->
      <div
        v-if="promptStore.loading"
        class="grid grid-cols-1 gap-3 md:gap-4 lg:grid-cols-2 lg:gap-5 2xl:grid-cols-4"
      >
        <div
          v-for="i in 8"
          :key="i"
          class="rounded-(--radius-lg) border border-default p-3.5 md:p-4 lg:p-5 space-y-3"
          :class="{
            'hidden lg:block': i >= 3 && i <= 4,
            'hidden 2xl:block': i >= 5
          }"
        >
          <USkeleton class="h-5 w-2/3" />
          <USkeleton class="h-4 w-full" />
          <USkeleton class="h-4 w-4/5" />
          <USkeleton class="h-16 w-full" />
        </div>
      </div>

      <!-- 加载失败 -->
      <div
        v-else-if="promptStore.loadError"
        class="flex flex-col items-center justify-center py-20 text-dimmed gap-3"
      >
        <UIcon
          name="i-lucide-alert-circle"
          class="w-10 h-10 text-error-500"
        />
        <p class="text-sm text-error-500">
          {{ promptStore.loadError }}
        </p>
        <UButton
          size="sm"
          color="error"
          variant="outline"
          icon="i-lucide-refresh-cw"
          @click="promptStore.getList()"
        >
          重试
        </UButton>
      </div>

      <!-- 空状态 -->
      <div
        v-else-if="promptStore.list.length === 0"
        class="flex flex-col items-center justify-center py-16 sm:py-20 text-dimmed gap-3"
      >
        <UIcon
          name="i-lucide-bookmark"
          class="w-8 sm:w-10 h-8 sm:h-10 opacity-25"
        />
        <p class="text-sm">
          暂无提示词
        </p>
        <UButton
          size="sm"
          color="primary"
          variant="outline"
          icon="i-lucide-plus"
          class="mt-2"
          @click="openCreate"
        >
          新建提示词
        </UButton>
      </div>

      <!-- 卡片网格 -->
      <div
        v-else
        class="grid grid-cols-1 gap-2 md:gap-3 lg:grid-cols-2 lg:gap-4 2xl:grid-cols-4"
      >
        <PromptsCard
          v-for="p in promptStore.list"
          :key="p.id"
          :prompt="p"
          @edit="openEdit"
          @delete="openDelete"
        />
      </div>
    </div>

    <!-- ========== 创建/编辑弹窗 ========== -->
    <PromptsFormModal
      :open="formModalOpen"
      :editing-prompt="editingPrompt"
      @close="closeFormModal"
    />

    <!-- ========== 删除确认弹窗 ========== -->
    <PromptsDeleteModal
      :open="deleteModalOpen"
      :prompting="deletingPrompt"
      @close="closeDeleteModal"
    />
  </div>
</template>
