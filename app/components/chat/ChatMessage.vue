<script setup lang="ts">
defineProps<{
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  isStreaming?: boolean
}>()
</script>

<template>
  <div class="flex flex-col py-4 px-4 group">
    <div
      class="flex gap-3"
      :class="role === 'user' ? 'flex-row-reverse' : ''"
    >
      <!-- 头像 -->
      <UAvatar
        :icon="role === 'user' ? 'i-lucide-user' : 'i-lucide-bot'"
        :color="role === 'user' ? 'primary' : 'neutral'"
        size="sm"
        class="shrink-0"
      />

      <!--
        消息体容器
        - 用户消息：纯文本渲染
        - 助手消息：Markdown 渲染 + 流式光标
        - Phase 2：toolCalls、reasoning 等内容段
      -->
      <ChatMessageBody
        :content="content"
        :role="role"
        :is-streaming="isStreaming"
      />
    </div>
    <div
      class="pt-1 flex"
      :class="role === 'user' ? 'justify-end pr-9' : 'justify-start pl-9'"
    >
      <ChatMessageActions
        :content="content"
        :role="role"
      />
    </div>
  </div>
</template>
