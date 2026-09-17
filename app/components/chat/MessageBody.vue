<script setup lang="ts">
import type { AgentToolCallItem } from '~/types/agent'
import type { CitationMeta } from '#shared/citation'
import { collectAllowedImagesFromTools } from '~/utils/allowedImages'
import { buildCitationIndex, emptyCitationIndex, isExternalSource } from '~/utils/citations'

const props = defineProps<{
  /** 聊天消息内容 */
  content: string
  /** 聊天消息角色 */
  role: 'user' | 'assistant' | 'tool' | 'system'
  /** 是否为流式传输中（显示打字光标） */
  isStreaming?: boolean
  hasError?: boolean
  /** 是否正在初始化中 */
  isInitializing?: boolean
  /** 气泡顶部渲染的工具调用步骤（Agent 模式） */
  tools?: AgentToolCallItem[]
}>()

const chatStore = useChatStore()

/** 本轮允许渲染的图片白名单（仅助手消息）：从同轮 search_knowledge_base 结果里提取图片 URL */
const allowedImages = computed(() =>
  props.role === 'assistant' ? collectAllowedImagesFromTools(props.tools) : new Set<string>()
)

/** 可引用的来源白名单来自 store（**对话级**，全消息共享一次计算）——见 chat.store 的 citationSources */
const citations = computed(() => chatStore.citationSources)

/**
 * 引用索引 —— **唯一一份**：正文渲染（chip 编号）与底部来源列表都读它。
 * 分两处各算一遍必然漂移（一个扫正文、一个扫来源集合，条件稍有出入就对不上号）。
 */
const citationIndex = computed(() =>
  props.role === 'assistant' ? buildCitationIndex(props.content, citations.value) : emptyCitationIndex()
)

// ==================== citation 点击 ====================

/** 预览弹层状态（本地即可：同一时刻只会有一个 chip 被点） */
const previewOpen = ref(false)
const previewSource = ref<CitationMeta | null>(null)

/** 点击分流：有可信原文链接 → 新窗口打开 GitHub；否则 → 打开系统内文档预览 */
function handleCitationClick(key: string) {
  const source = citations.value.get(key)
  if (!source) return

  if (isExternalSource(source)) {
    // noopener：被打开的页面拿不到 window.opener，防 reverse tabnabbing
    window.open(source.u!, '_blank', 'noopener,noreferrer')
    return
  }

  previewSource.value = source
  previewOpen.value = true
}
</script>

<template>
  <!-- 消息气泡 -->
  <div
    class=" rounded-(--radius-lg) px-4 py-2.5 text-sm leading-relaxed"
    :class="[
      role === 'user'
        ? 'bg-(--ui-primary) text-white max-w-[80%]'
        : 'bg-(--ui-bg) text-(--ui-text) !py-0 w-[calc(100%-78px)]',
      hasError
        ? 'border-2 border-error-500 dark:border-error-500/60 bg-error-50 dark:bg-error-500/10'
        : ''

    ]"
  >
    <!-- ===== 工具调用步骤（Agent 模式下在气泡内展示） ===== -->
    <AgentToolInline
      v-if="tools?.length"
      :tool-calls="tools"
    />

    <!-- ===== 新增：无内容 + 错误 = 显示错误文案 ===== -->
    <p
      v-if="hasError && !content"
      class="text-error-700 dark:text-error-500 text-sm"
    >
      ⚠️ {{ chatStore.streamError || '生成失败' }}
    </p>

    <template v-if="content">
      <!-- ===== Markdown 渲染（仅助手消息） ===== -->
      <ChatMarkdownContent
        v-if="role === 'assistant'"
        :content="content"
        :is-streaming="isStreaming ?? false"
        :allowed-images="allowedImages"
        :citation-index="citationIndex"
        @citation-click="handleCitationClick"
      />

      <!-- ===== 参考来源（引用溯源 3.11）=====
           流式期间不渲染：列表会在生成过程中不断增长，观感很跳 -->
      <ChatMessageSources
        v-if="role === 'assistant' && !isStreaming && citationIndex.ordered.length > 0"
        :sources="citationIndex.ordered"
        @select="handleCitationClick"
      />

      <!-- ===== 用户消息纯文本 ===== -->
      <p
        v-else-if="role === 'user'"
        class="whitespace-pre-wrap break-words"
      >
        {{ content }}
      </p>

      <!-- 错误时在内容末尾加分隔线和错误提示 -->
      <div
        v-if="hasError"
        class="mt-2 pt-2 border-t border-error-500/40 dark:border-error-500/50"
      >
        <p class="text-error-700 dark:text-error-500 text-xs">
          ⚠️ {{ chatStore.streamError || '生成中断' }}
        </p>
      </div>
    </template>

    <!-- ===== 流式光标 ===== -->
    <UIcon
      v-if="isInitializing && role === 'assistant'"
      name="i-lucide-sparkles"
      class="inline-block w-4 h-4 text-(--ui-primary) animate-pulse"
    />

    <!-- ===== citation 预览弹层（点来源 chip 且无 GitHub 原文时打开） ===== -->
    <ChatCitationPreviewSlideover
      v-if="role === 'assistant'"
      :open="previewOpen"
      :source="previewSource"
      @close="previewOpen = false"
    />
  </div>
</template>
