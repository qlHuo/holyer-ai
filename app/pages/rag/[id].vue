<script lang="ts" setup>
import type { DocumentSummary } from '~~/shared/types/rag'
import { kbInitial, kbAvatarClasses } from '~/utils/kbAvatar'
// 显式 import：避免依赖 Nuxt 自动组件注册的扫描时序（新建文件需重启才进注册清单）
import GitHubImportModal from '~/components/rag/GitHubImportModal.vue'

const chatStore = useChatStore()
const ragStore = useRagStore()
const route = useRoute()

const kbId = computed(() => String(route.params.id))

/** 页头身份块（与卡片同源：首字母 + 按创建时间取色） */
const kbChar = computed(() => kbInitial(ragStore.activeKb?.name ?? ''))
const kbColorClass = computed(() => kbAvatarClasses(ragStore.activeKb?.createdAt ?? ''))

// ==================== 初始化 ====================

/** 进入/切换库：清会话上下文 → 定位当前库 → 确保 kb 元数据 → 加载文档 */
async function init() {
  chatStore.currentConvId = null
  ragStore.setCurrentKbId(kbId.value)
  if (ragStore.kbList.length === 0) {
    await ragStore.getKBs()
  }
  await ragStore.loadDocuments(kbId.value)
}

onMounted(init)
watch(kbId, () => {
  // 同组件内切换 /rag/a → /rag/b（重置文档态避免残留）
  init()
})

// ==================== 上传弹窗控制 ====================
const uploadModalOpen = ref(false)

function openUpload() {
  uploadModalOpen.value = true
}

function closeUploadModal() {
  uploadModalOpen.value = false
}

// ==================== GitHub 引入弹窗控制 ====================
const githubModalOpen = ref(false)

function openGithubImport() {
  githubModalOpen.value = true
}

// ==================== 删除弹窗控制 ====================
const deleteModalOpen = ref(false)
const deletingDoc = ref<DocumentSummary | null>(null)

function openDelete(doc: DocumentSummary) {
  deletingDoc.value = doc
  deleteModalOpen.value = true
}

function closeDeleteModal() {
  deleteModalOpen.value = false
}

// =================== 返回知识库列表 ====================
function handleBackToKbList() {
  navigateTo('/rag')
}
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- ========== 顶部标题栏 ========== -->
    <div class="shrink-0 p-4">
      <!-- 行 1：返回 + 首字母身份块 + 库名（过长省略，title 可看全名） -->
      <div class="flex items-center gap-2 min-w-0">
        <UButton
          icon="i-lucide-arrow-left"
          variant="ghost"
          color="neutral"
          size="sm"
          class="shrink-0"
          title="返回知识库列表"
          @click="handleBackToKbList"
        />
        <div
          class="shrink-0 w-6 h-6 rounded-md text-xs font-semibold flex items-center justify-center select-none"
          :class="kbColorClass"
        >
          {{ kbChar }}
        </div>
        <h2
          class="flex-1 min-w-0 text-base font-semibold text-highlighted truncate leading-snug"
          :title="ragStore.activeKb?.name || ''"
        >
          {{ ragStore.activeKb?.name || '知识库' }}
        </h2>
        <!-- 文档数量 — 复用卡片的 UBadge 样式，紧跟库名 -->
        <UBadge
          v-if="!ragStore.docsLoading && !ragStore.docsError && ragStore.documents.length > 0"
          size="sm"
          color="primary"
          variant="subtle"
          class="shrink-0"
        >
          {{ ragStore.documents.length }} 篇
        </UBadge>
      </div>

      <!-- 行 2：操作工具条（未来过滤/刷新控件加在左侧占位区，上传靠右） -->
      <div class="mt-4 flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <!-- 未来过滤 / 刷新占位 -->
        </div>
        <div class="flex items-center gap-2 ml-auto">
          <UButton
            icon="i-lucide-github"
            variant="outline"
            color="neutral"
            size="sm"
            @click="openGithubImport"
          >
            从 GitHub 引入
          </UButton>
          <UButton
            icon="i-lucide-upload"
            color="primary"
            size="sm"
            @click="openUpload"
          >
            上传文档
          </UButton>
        </div>
      </div>
    </div>

    <!-- ========== 内容区 ========== -->
    <div class="flex-1 overflow-auto px-4 pb-4">
      <!-- 加载中 -->
      <div
        v-if="ragStore.docsLoading"
        class="space-y-2"
      >
        <div
          v-for="i in 8"
          :key="i"
          class="flex items-center gap-3 px-3 py-2.5"
        >
          <USkeleton class="h-4 w-4 shrink-0" />
          <div class="flex-1 space-y-2">
            <USkeleton class="h-4 w-2/3" />
            <USkeleton class="h-3 w-1/3" />
          </div>
        </div>
      </div>

      <!-- 加载失败 -->
      <div
        v-else-if="ragStore.docsError"
        class="flex flex-col items-center justify-center py-20 text-dimmed gap-3"
      >
        <UIcon
          name="i-lucide-alert-circle"
          class="w-10 h-10 text-error-500"
        />
        <p class="text-sm text-error-500">
          {{ ragStore.docsError }}
        </p>
        <UButton
          size="sm"
          color="error"
          variant="outline"
          icon="i-lucide-refresh-cw"
          @click="ragStore.loadDocuments(kbId)"
        >
          重试
        </UButton>
      </div>

      <!-- 空状态 -->
      <div
        v-else-if="ragStore.documents.length === 0"
        class="flex flex-col items-center justify-center py-16 sm:py-20 text-dimmed gap-3"
      >
        <UIcon
          name="i-lucide-file-text"
          class="w-8 sm:w-10 h-8 sm:h-10 opacity-25"
        />
        <p class="text-sm">
          暂无文档
        </p>
        <div class="mt-2 flex flex-wrap items-center justify-center gap-2">
          <UButton
            size="sm"
            color="neutral"
            variant="ghost"
            icon="i-lucide-github"
            @click="openGithubImport"
          >
            从 GitHub 仓库引入
          </UButton>
          <UButton
            size="sm"
            color="primary"
            variant="outline"
            icon="i-lucide-upload"
            @click="openUpload"
          >
            上传本地 .md
          </UButton>
        </div>
      </div>

      <!-- 文档行列表（直角容器） -->
      <div
        v-else
        class="border border-default divide-y divide-default"
      >
        <RagDocumentRow
          v-for="doc in ragStore.documents"
          :key="doc.id"
          :doc="doc"
          @delete="openDelete"
        />
      </div>
    </div>

    <!-- ========== GitHub 引入弹窗 ========== -->
    <GitHubImportModal
      :open="githubModalOpen"
      :kb-id="kbId"
      @close="githubModalOpen = false"
    />

    <!-- ========== 上传弹窗 ========== -->
    <RagUploadDocumentModal
      :open="uploadModalOpen"
      :kb-id="kbId"
      @close="closeUploadModal"
    />

    <!-- ========== 删除确认弹窗 ========== -->
    <RagDocumentDeleteModal
      :open="deleteModalOpen"
      :deleting-doc="deletingDoc"
      @close="closeDeleteModal"
    />
  </div>
</template>
