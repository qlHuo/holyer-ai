<script lang="ts" setup>
import type { CitationMeta } from '#shared/citation'
import type { DocumentDetail } from '~~/shared/types/rag'
import RagApi from '~/api/rag'
import { sourceAnchor } from '~/utils/citations'

/**
 * citation 预览弹层（引用溯源 3.11）
 *
 * 点来源 chip 且该来源**没有 GitHub 原文链接**时打开（有外链的直接新窗口跳 GitHub，
 * 分流逻辑在 MessageBody.handleCitationClick）。
 *
 * 文档删了/被「覆盖上传」替换过 → docId 已失效（覆盖 = 新建 + 删旧，见
 * server/service/rag/documents.ts 的 createDocument），此处显式降级并给「去知识库」出口，
 * 而不是静默失败让用户以为 chip 坏了。
 */
const props = defineProps<{
  open: boolean
  source: CitationMeta | null
}>()

const emit = defineEmits<{
  close: []
}>()

const toast = useToast()

const modalOpen = computed({
  get: () => props.open,
  set: (v: boolean) => { if (!v) emit('close') }
})

const loading = ref(false)
const notFound = ref(false)
const detail = ref<DocumentDetail | null>(null)

/** 正文容器（定位锚点用） */
const bodyRef = ref<HTMLElement | null>(null)

/** 预览的图片白名单：该文档所有 chunk 的图片并集（按文档来源限定，与检索侧同一原则） */
const allowedImages = computed(() => new Set(detail.value?.imageUrls ?? []))

/**
 * 尽力滚动到引用的小节：按标题文本匹配（headingPath 末级）。
 * 找不到就停在文档顶部 —— 预览本身仍是可用的，不做更激进的定位。
 */
async function scrollToAnchor(): Promise<void> {
  await nextTick()
  const anchor = props.source ? sourceAnchor(props.source) : null
  const root = bodyRef.value
  if (!anchor || !root) return

  for (const h of root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
    if (h.textContent?.trim() === anchor) {
      h.scrollIntoView({ block: 'start' })
      h.classList.add('citation-preview-anchor')
      return
    }
  }
}

watch(
  () => [props.open, props.source?.d] as const,
  async ([isOpen, docId]) => {
    if (!isOpen || !docId) return
    loading.value = true
    notFound.value = false
    detail.value = null
    try {
      detail.value = await RagApi.getDocumentDetail(docId)
      await scrollToAnchor()
    } catch {
      notFound.value = true
    } finally {
      loading.value = false
    }
  },
  { immediate: true }
)

function goToKnowledgeBase() {
  const kbId = props.source?.b
  emit('close')
  if (kbId) navigateTo(`/rag/${kbId}`)
}

/** 复制原文：与知识库列表页的「下载原文」同源数据，这里只放进剪贴板 */
function copyContent() {
  if (!detail.value) return
  navigator.clipboard.writeText(detail.value.content).then(() => {
    toast.add({ title: '已复制原文', color: 'primary', icon: 'i-lucide-check' })
  }).catch(() => {
    toast.add({ title: '复制失败', color: 'error' })
  })
}
</script>

<template>
  <UModal
    v-model:open="modalOpen"
    :title="source?.t || '来源文档'"
    :ui="{ content: 'sm:max-w-[760px]', body: 'max-h-[65vh] overflow-y-auto' }"
  >
    <template #body>
      <!-- 引用位置（标题路径） -->
      <p
        v-if="source?.h?.length"
        class="flex items-center gap-1 text-xs text-dimmed mb-3"
      >
        <UIcon
          name="i-lucide-list-tree"
          class="size-3.5 shrink-0"
        />
        {{ source.h.join(' › ') }}
      </p>

      <div v-if="loading">
        <USkeleton class="h-4 w-3/4 mb-2" />
        <USkeleton class="h-4 w-full mb-2" />
        <USkeleton class="h-4 w-5/6" />
      </div>

      <!-- 文档已失效（被覆盖上传替换或删除） -->
      <div
        v-else-if="notFound"
        class="flex flex-col items-center text-center gap-2 py-6"
      >
        <UIcon
          name="i-lucide-file-x"
          class="w-8 h-8 text-dimmed"
        />
        <p class="text-sm text-default">
          该文档已被覆盖更新或删除
        </p>
        <p class="text-xs text-dimmed">
          历史引用可能失效，可去知识库查看最新版本
        </p>
        <UButton
          v-if="source?.b"
          color="primary"
          variant="soft"
          size="xs"
          class="mt-1"
          @click="goToKnowledgeBase"
        >
          去知识库
        </UButton>
      </div>

      <div
        v-else-if="detail"
        ref="bodyRef"
      >
        <ChatMarkdownContent
          :content="detail.content"
          :allowed-images="allowedImages"
        />
      </div>
    </template>

    <template #footer>
      <UButton
        color="neutral"
        variant="ghost"
        @click="emit('close')"
      >
        关闭
      </UButton>
      <UButton
        v-if="detail"
        color="neutral"
        variant="soft"
        icon="i-lucide-copy"
        @click="copyContent"
      >
        复制原文
      </UButton>
    </template>
  </UModal>
</template>
