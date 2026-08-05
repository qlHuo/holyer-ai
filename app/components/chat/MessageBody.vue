<script setup lang="ts">
defineProps<{
  /** 聊天消息内容 */
  content: string
  /** 聊天消息角色 */
  role: 'user' | 'assistant' | 'tool' | 'system'
  /** 是否为流式传输中（显示打字光标） */
  isStreaming?: boolean
  hasError?: boolean
  /** 是否正在初始化中 */
  isInitializing?: boolean
  /** 是否在气泡顶部渲染工具调用步骤面板 */
  showTools?: boolean
}>()

const chatStore = useChatStore()
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
    <AgentToolInline v-if="showTools" />

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
  </div>
</template>
