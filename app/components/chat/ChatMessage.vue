<script setup lang="ts">
import type { AgentToolCallItem } from '~/types/agent'

defineProps<{
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  isStreaming?: boolean
  hasError?: boolean
  isInitializing?: boolean
  showRegenerate?: boolean
  /** 气泡内展示的工具调用步骤（Agent 模式） */
  tools?: AgentToolCallItem[]
}>()
</script>

<template>
  <div class="flex flex-col py-4 px-4 group animate-message-enter">
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
        - Agent 模式下通过 tools prop 在气泡内渲染工具调用步骤
      -->
      <ChatMessageBody
        :content="content"
        :role="role"
        :is-streaming="isStreaming"
        :has-error="hasError"
        :is-initializing="isInitializing"
        :tools="tools"
      />
    </div>
    <div
      class="pt-1 flex"
      :class="role === 'user' ? 'justify-end pr-9' : 'justify-start pl-9'"
    >
      <ChatMessageActions
        :content="content"
        :role="role"
        :has-error="hasError"
        :show-regenerate="showRegenerate"
      />
    </div>
  </div>
</template>
