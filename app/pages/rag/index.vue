<script lang="ts" setup>
import type { KnowledgeBase } from '~~/shared/types/rag'

const chatStore = useChatStore()
const ragStore = useRagStore()

// ==================== 页面初始化 ====================

onMounted(() => {
  chatStore.currentConvId = null
  ragStore.getKBs()
})

// ==================== 表单弹窗控制 ====================

const formModalOpen = ref(false)
const editingKb = ref<KnowledgeBase | null>(null)

function openCreate() {
  editingKb.value = null
  formModalOpen.value = true
}

function openEdit(kb: KnowledgeBase) {
  editingKb.value = kb
  formModalOpen.value = true
}

function closeFormModal() {
  formModalOpen.value = false
}

// ==================== 删除弹窗控制 ====================

const deleteModalOpen = ref(false)
const deletingKb = ref<KnowledgeBase | null>(null)

function openDelete(kb: KnowledgeBase) {
  deletingKb.value = kb
  deleteModalOpen.value = true
}

function closeDeleteModal() {
  deleteModalOpen.value = false
}

// ==================== 进入库 ====================

function openKb(kb: KnowledgeBase) {
  navigateTo(`/rag/${kb.id}`)
}
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- ========== 顶部标题栏 ========== -->
    <div class="shrink-0 flex items-center justify-between gap-3 p-4">
      <div class="flex items-baseline gap-2 min-w-0">
        <div class="flex items-center gap-2">
          <div
            class="w-6 h-6 rounded-md bg-primary/10 text-primary flex items-center justify-center"
          >
            <UIcon
              name="i-lucide-database"
              class="w-3.5 h-3.5"
            />
          </div>
          <h1 class="text-lg font-semibold text-highlighted tracking-tight">
            知识库
          </h1>
        </div>
        <span
          v-if="!ragStore.loading"
          class="text-xs text-dimmed truncate"
        >
          {{ ragStore.kbList.length }} 个
        </span>
      </div>

      <UButton
        icon="i-lucide-plus"
        color="primary"
        class="shrink-0"
        @click="openCreate"
      >
        新建知识库
      </UButton>
    </div>

    <!-- ========== 内容区 ========== -->
    <div class="flex-1 overflow-auto p-4 pt-0">
      <!-- 加载中 -->
      <div
        v-if="ragStore.loading"
        class="grid grid-cols-1 gap-3 md:gap-4 lg:grid-cols-2 lg:gap-5 2xl:grid-cols-4"
      >
        <div
          v-for="i in 8"
          :key="i"
          class="rounded-lg border border-default p-3.5 md:p-4 lg:p-5 space-y-3"
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
        v-else-if="ragStore.loadError"
        class="flex flex-col items-center justify-center py-20 text-dimmed gap-3"
      >
        <UIcon
          name="i-lucide-alert-circle"
          class="w-10 h-10 text-error-500"
        />
        <p class="text-sm text-error-500">
          {{ ragStore.loadError }}
        </p>
        <UButton
          size="sm"
          color="error"
          variant="outline"
          icon="i-lucide-refresh-cw"
          @click="ragStore.getKBs()"
        >
          重试
        </UButton>
      </div>

      <!-- 空状态 -->
      <div
        v-else-if="ragStore.kbList.length === 0"
        class="flex flex-col items-center justify-center py-16 sm:py-20 text-dimmed gap-3"
      >
        <UIcon
          name="i-lucide-database"
          class="w-8 sm:w-10 h-8 sm:h-10 opacity-25"
        />
        <p class="text-sm">
          暂无知识库
        </p>
        <UButton
          size="sm"
          color="primary"
          variant="outline"
          icon="i-lucide-plus"
          class="mt-2"
          @click="openCreate"
        >
          新建知识库
        </UButton>
      </div>

      <!-- 卡片网格 -->
      <div
        v-else
        class="grid grid-cols-1 gap-2 md:gap-3 lg:grid-cols-2 lg:gap-4 2xl:grid-cols-4"
      >
        <RagKbCard
          v-for="kb in ragStore.kbList"
          :key="kb.id"
          :kb="kb"
          @open="openKb"
          @edit="openEdit"
          @delete="openDelete"
        />
      </div>
    </div>

    <!-- ========== 创建/编辑弹窗 ========== -->
    <RagKbFormModal
      :open="formModalOpen"
      :editing-kb="editingKb"
      @close="closeFormModal"
    />

    <!-- ========== 删除确认弹窗 ========== -->
    <RagKbDeleteModal
      :open="deleteModalOpen"
      :deleting-kb="deletingKb"
      @close="closeDeleteModal"
    />
  </div>
</template>
