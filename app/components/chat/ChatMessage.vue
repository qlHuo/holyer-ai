<script setup lang="ts">
defineProps({
  /** 消息角色 */
  role: {
    type: String,
    required: true,
    validator: (v: string) => ['user', 'assistant', 'system'].includes(v)
  },
  /** 消息内容 */
  content: {
    type: String,
    required: true
  },
  /** 是否为流式传输中（显示打字光标） */
  isStreaming: {
    type: Boolean,
    default: false
  }
})
</script>

<template>
  <div
    class="flex gap-3 py-4 px-4"
    :class="role === 'user' ? 'flex-row-reverse' : ''"
  >
    <!-- 头像 -->
    <UAvatar
      :icon="role === 'user' ? 'i-lucide-user' : 'i-lucide-bot'"
      :color="role === 'user' ? 'primary' : 'neutral'"
      size="sm"
      class="shrink-0"
    />

    <!-- 消息体 -->
    <div
      class="max-w-[75%] rounded-lg px-4 py-2.5 text-sm leading-relaxed"
      :class="role === 'user'
        ? 'bg-(--ui-primary) text-white'
        : 'bg-(--ui-bg-elevated) text-(--ui-text)'"
    >
      <!-- 内容（保留换行） -->
      <p class="whitespace-pre-wrap break-words">
        {{ content }}
        <!-- 流式光标 -->
        <span
          v-if="isStreaming && role === 'assistant'"
          class="inline-block w-2 h-4 ml-0.5 bg-current animate-pulse align-text-bottom"
        />
      </p>
    </div>
  </div>
</template>
