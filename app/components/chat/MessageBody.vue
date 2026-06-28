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
}>()

const chatStore = useChatStore()
</script>

<template>
  <!-- 消息气泡 -->
  <div
    class="max-w-[75%] rounded-(--radius-lg) px-4 py-2.5 text-sm leading-relaxed shadow-(--shadow-sm)"
    :class="[
      role === 'user'
        ? 'bg-(--ui-primary) text-white'
        : 'bg-(--ui-bg-elevated) text-(--ui-text) max-w-[calc(100%-36px)]',
      hasError
        ? 'border-2 border-error-500 dark:border-error-500/60 bg-error-50 dark:bg-error-500/10'
        : ''

    ]"
  >
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
