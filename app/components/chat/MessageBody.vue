<script setup lang="ts">
defineProps({
  /** 聊天消息内容 */
  content: {
    type: String,
    default: ''
  },
  /** 聊天消息角色 */
  role: {
    type: String as () => 'user' | 'assistant' | 'tool' | 'system',
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
  <!-- 消息气泡 -->
  <div
    class="max-w-[75%] rounded-lg px-4 py-2.5 text-sm leading-relaxed"
    :class="role === 'user'
      ? 'bg-(--ui-primary) text-white'
      : 'bg-(--ui-bg-elevated) text-(--ui-text)'"
  >
    <!-- ===== Phase 2：推理过程（折叠） ===== -->
    <!--
    <ReasoningBlock v-if="reasoning" :content="reasoning" />
    -->

    <!-- ===== Markdown 渲染（仅助手消息） ===== -->
    <ChatMarkdownContent
      v-if="role === 'assistant' && content"
      :content="content"
    />

    <!-- ===== 用户消息纯文本 ===== -->
    <p
      v-else-if="role === 'user' && content"
      class="whitespace-pre-wrap break-words"
    >
      {{ content }}
    </p>

    <!-- ===== Phase 2：工具调用卡片列表 ===== -->
    <!--
    <ToolCallList v-if="toolCalls?.length" :calls="toolCalls" />
    -->

    <!-- ===== 流式光标 ===== -->
    <span
      v-if="isStreaming && role === 'assistant'"
      class="inline-block w-0.5 h-5 ml-0.5 bg-current animate-pulse align-text-bottom"
    />
  </div>
</template>
