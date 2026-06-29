<script setup lang="ts">
import type { MessageSearchResult } from '~~/server/service/conversation/queries'
import SearchApi from '~/api/search'

withDefaults(defineProps<{
  /** 触发按钮尺寸 */
  size?: 'xs' | 'sm' | 'md'
  /** 触发按钮的 title 提示文字 */
  title?: string
}>(), {
  size: 'sm',
  title: '搜索消息'
})

const { switchConversation } = useChat()
const toast = useToast()

// ==================== 状态 ====================
const open = ref(false)
const query = ref('')
const results = ref<MessageSearchResult[]>([])
const loading = ref(false)
const selectedIndex = ref(0)
const inputRef = ref<{ $el: HTMLElement } | null>(null)

/** 聚焦搜索输入框（UInput 组件需要通过内部 DOM 查找 input 元素） */
function focusInput() {
  inputRef.value?.$el?.querySelector('input')?.focus()
}
let debounceTimer: ReturnType<typeof setTimeout> | null = null

// ==================== 计算属性 ====================

/** 是否已执行过搜索（区分"初始空状态"与"无结果"） */
const hasSearched = ref(false)

/** 按对话分组 */
interface ResultGroup {
  conversationId: string
  conversationTitle: string
  messages: MessageSearchResult[]
}

const groupedResults = computed<ResultGroup[]>(() => {
  const map = new Map<string, ResultGroup>()
  for (const r of results.value) {
    const existing = map.get(r.conversationId)
    if (existing) {
      existing.messages.push(r)
    } else {
      map.set(r.conversationId, {
        conversationId: r.conversationId,
        conversationTitle: r.conversationTitle,
        messages: [r]
      })
    }
  }
  return [...map.values()]
})

/** 所有结果展平（用于键盘导航索引计算） */
const flatResults = computed(() => {
  const flat: Array<{ result: MessageSearchResult, groupIdx: number }> = []
  for (const [gi, group] of groupedResults.value.entries()) {
    for (const msg of group.messages) {
      flat.push({ result: msg, groupIdx: gi })
    }
  }
  return flat
})

const totalCount = computed(() => flatResults.value.length)

// ==================== 监听 ====================

/** 打开时重置状态并聚焦输入框 */
watch(open, (val) => {
  if (val) {
    query.value = ''
    results.value = []
    selectedIndex.value = 0
    hasSearched.value = false
    nextTick(() => focusInput())
  }
})

/** 输入变化 → 防抖搜索 */
watch(query, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  selectedIndex.value = 0

  if (!val.trim()) {
    results.value = []
    hasSearched.value = false
    return
  }

  debounceTimer = setTimeout(() => {
    performSearch(val.trim())
  }, 200)
})

// ==================== 方法 ====================

async function performSearch(q: string) {
  loading.value = true
  hasSearched.value = true
  try {
    results.value = await SearchApi.search(q)
  } catch (err: any) {
    results.value = []
    toast.add({
      title: err?.message || '搜索失败',
      color: 'error',
      icon: 'i-lucide-alert-circle'
    })
  } finally {
    loading.value = false
  }
}

/** 跳转到搜索结果所在的对话 */
async function goToResult(result: MessageSearchResult) {
  try {
    await switchConversation(result.conversationId)
    open.value = false
  } catch (err: any) {
    toast.add({
      title: err?.message || '切换对话失败',
      color: 'error',
      icon: 'i-lucide-alert-circle'
    })
  }
}

// ==================== 键盘导航 ====================

function handleKeydown(e: KeyboardEvent) {
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      if (totalCount.value > 0) {
        selectedIndex.value = (selectedIndex.value + 1) % totalCount.value
      }
      break
    case 'ArrowUp':
      e.preventDefault()
      if (totalCount.value > 0) {
        selectedIndex.value = (selectedIndex.value - 1 + totalCount.value) % totalCount.value
      }
      break
    case 'Enter':
      e.preventDefault()
      {
        const selected = flatResults.value[selectedIndex.value]
        if (selected) {
          goToResult(selected.result)
        }
      }
      break
  }
}

// ==================== 高亮 ====================

/**
 * 将消息内容中匹配 query 的部分用 <mark> 标签包裹。
 * 同时生成约 80 字符的上下文片段（以第一个匹配为中心）。
 */
function highlightContent(content: string, searchQuery: string): string {
  const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${escaped})`, 'gi')

  // 截取以第一个匹配为中心的上下文片段（约 80 字符）
  const matchIndex = content.toLowerCase().indexOf(searchQuery.toLowerCase())
  if (matchIndex === -1) {
    // 兜底：截前 120 字符
    return escapeHtml(content.slice(0, 120)) + (content.length > 120 ? '…' : '')
  }

  const contextRadius = 60
  const start = Math.max(0, matchIndex - contextRadius)
  const end = Math.min(content.length, matchIndex + searchQuery.length + contextRadius)
  let snippet = content.slice(start, end)
  if (start > 0) snippet = '…' + snippet
  if (end < content.length) snippet += '…'

  return snippet.replace(regex, '<mark>$1</mark>')
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 角色标签 */
function roleLabel(role: string): string {
  return role === 'user' ? '你' : 'AI'
}
</script>

<template>
  <!-- ========== 触发按钮 ========== -->
  <UButton
    icon="i-lucide-search"
    variant="ghost"
    :size="size"
    color="neutral"
    :title="title"
    @click="open = true"
  />

  <!-- ========== 搜索弹窗 ========== -->
  <UModal
    v-model:open="open"
    title="搜索消息"
    :ui="{ content: 'sm:max-w-[720px]' }"
  >
    <template #body>
      <div
        class="flex flex-col"
        :style="{ height: '540px', maxHeight: '70vh' }"
        @keydown="handleKeydown"
      >
        <!-- ========== 搜索输入 ========== -->
        <div class="shrink-0 pb-4">
          <UInput
            ref="inputRef"
            v-model="query"
            placeholder="搜索所有对话中的消息…"
            size="lg"
            variant="outline"
            icon="i-lucide-search"
            class="w-full"
            :ui="{ trailing: 'pe-1.5' }"
          >
            <template
              v-if="query.trim()"
              #trailing
            >
              <UButton
                icon="i-lucide-x"
                size="xs"
                variant="ghost"
                color="neutral"
                aria-label="清空搜索"
                @click="query = ''"
              />
            </template>
          </UInput>
        </div>

        <!-- ========== 结果区域 ========== -->
        <div class="flex-1 overflow-y-auto">
          <!-- 初始：输入提示 -->
          <div
            v-if="!query.trim()"
            class="flex flex-col items-center justify-center h-full text-(--ui-text-dimmed) gap-3"
          >
            <UIcon
              name="i-lucide-text-search"
              class="w-10 h-10 opacity-30"
            />
            <p class="text-sm">
              输入关键词搜索历史消息
            </p>
          </div>

          <!-- 加载中 -->
          <div
            v-else-if="loading"
            class="flex items-center justify-center h-full"
          >
            <div class="flex items-center gap-2 text-(--ui-text-dimmed)">
              <UIcon
                name="i-lucide-loader"
                class="w-4 h-4 animate-spin"
              />
              <span class="text-sm">搜索中…</span>
            </div>
          </div>

          <!-- 无结果 -->
          <div
            v-else-if="hasSearched && totalCount === 0"
            class="flex flex-col items-center justify-center h-full text-(--ui-text-dimmed) gap-3"
          >
            <UIcon
              name="i-lucide-search-x"
              class="w-10 h-10 opacity-30"
            />
            <p class="text-sm">
              未找到匹配的消息
            </p>
            <p class="text-xs opacity-60">
              尝试使用不同的关键词
            </p>
          </div>

          <!-- 结果列表 -->
          <div
            v-else
            class="py-2"
          >
            <template
              v-for="group in groupedResults"
              :key="group.conversationId"
            >
              <!-- 分组标题 -->
              <div
                class="flex items-center gap-2 px-4 py-2 text-xs font-medium text-(--ui-text-dimmed)"
              >
                <UIcon
                  name="i-lucide-message-square"
                  class="w-3.5 h-3.5"
                />
                <span class="truncate">{{ group.conversationTitle }}</span>
                <span class="opacity-50">{{ group.messages.length }} 条</span>
              </div>

              <!-- 消息条目 -->
              <div
                v-for="msg in group.messages"
                :key="msg.messageId"
                class="mx-3 mb-0.5 px-3 py-2.5 rounded-(--radius-lg) cursor-pointer transition-colors
                       group/result"
                :class="flatResults[selectedIndex]?.result.messageId === msg.messageId
                  ? 'bg-(--ui-primary)/12'
                  : 'hover:bg-(--ui-bg)'"
                @click="goToResult(msg)"
                @mouseenter="selectedIndex = flatResults.findIndex(f => f.result.messageId === msg.messageId)"
              >
                <div class="flex items-center gap-2 mb-1">
                  <span
                    class="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-px rounded-full shrink-0"
                    :class="msg.role === 'user'
                      ? 'bg-(--ui-primary)/10 text-(--ui-primary)'
                      : 'bg-(--ui-bg) text-(--ui-text-dimmed)'"
                  >
                    {{ roleLabel(msg.role) }}
                  </span>
                  <span class="text-[10px] text-(--ui-text-dimmed)">
                    {{ new Date(msg.createdAt).toLocaleDateString('zh-CN') }}
                  </span>
                </div>
                <p
                  class="text-sm leading-relaxed line-clamp-2"
                  v-html="highlightContent(msg.content, query)"
                />
              </div>
            </template>
          </div>
        </div>

        <!-- ========== 底部快捷键提示 ========== -->
        <div
          v-if="totalCount > 0"
          class="shrink-0 flex items-center gap-4 px-4 py-2.5 border-t border-(--ui-border)
                 text-[11px] text-(--ui-text-dimmed)"
        >
          <span class="flex items-center gap-1">
            <UKbd>↑↓</UKbd> 导航
          </span>
          <span class="flex items-center gap-1">
            <UKbd>Enter</UKbd> 跳转
          </span>
          <span class="flex items-center gap-1">
            <UKbd>Esc</UKbd> 关闭
          </span>
          <span class="ml-auto">{{ totalCount }} 条结果</span>
        </div>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
/* 搜索高亮 — 暖金色荧光笔效果，与品牌色形成对比 */
:deep(mark) {
  background-color: #fde047;
  color: #422006;
  border-radius: 1px;
  padding: 0 1px;
}

.dark :deep(mark) {
  background-color: #ca8a04;
  color: #fef9c3;
}
</style>
