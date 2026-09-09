<script lang="ts" setup>
import type { DocumentSummary } from '~~/shared/types/rag'

defineProps<{
  doc: DocumentSummary
}>()

const emit = defineEmits<{
  delete: [doc: DocumentSummary]
}>()

const ragStore = useRagStore()
const toast = useToast()

/** 正在下载中（逐行独立状态） */
const downloading = ref(false)

function formatDate(isoStr: string): string {
  return new Date(isoStr).toLocaleDateString('zh-CN')
}

/** 下载原始 .md */
async function download(doc: DocumentSummary) {
  downloading.value = true
  try {
    await ragStore.downloadDocument(doc)
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '下载失败'
    toast.add({ title: msg, color: 'error', icon: 'i-lucide-alert-circle' })
  } finally {
    downloading.value = false
  }
}
</script>

<template>
  <div
    class="group flex items-center gap-3 px-3 py-2.5 hover:bg-default transition-colors"
  >
    <!-- .md 图标 — 琥珀暖点缀 -->
    <div
      class="shrink-0 w-8 h-8 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400
             flex items-center justify-center"
    >
      <UIcon
        name="i-lucide-file-text"
        class="w-4 h-4"
      />
    </div>

    <div class="flex-1 min-w-0">
      <p class="text-sm font-medium text-default truncate">
        {{ doc.title }}
      </p>
      <p class="text-xs text-dimmed mt-0.5 truncate">
        <span class="text-primary font-medium">{{ doc.chunkCount }}</span>
        个切片 · {{ formatDate(doc.createdAt) }}
        <span
          v-if="doc.sourceType === 'github'"
          class="inline-flex items-center gap-0.5 text-dimmed"
          title="来源：GitHub 引入"
        >
          · <UIcon
            name="i-lucide-github"
            class="w-3 h-3"
          /> GitHub
        </span>
      </p>
    </div>

    <!-- 操作（常显） -->
    <div class="flex items-center gap-0.5 shrink-0">
      <UButton
        icon="i-lucide-download"
        variant="ghost"
        size="xs"
        color="primary"
        title="下载原文"
        :loading="downloading"
        @click="download(doc)"
      />
      <UButton
        icon="i-lucide-trash"
        variant="ghost"
        size="xs"
        color="error"
        title="删除"
        @click="emit('delete', doc)"
      />
    </div>
  </div>
</template>
