<script setup lang="ts">
import { buildRenderItems, type RenderItem } from '~/utils/buildRenderItems'
import type { AgentToolCallItem } from '~/types/agent'

const chatStore = useChatStore()
// useChat 是模块级单例，多次调用安全
const { error: chatError } = useChat()
const toast = useToast()

/** 消息列表容器引用（用于自动滚底） */
const messagesContainer = ref<HTMLElement | null>(null)

/** 欢迎页 → ChatInput 预填充文本 */
const prefillContent = ref('')

/** 是否显示欢迎页（排除 API 加载中的短暂空态） */
const showWelcome = computed(() =>
  !chatStore.isStreaming && !chatStore.messagesLoading && chatStore.messages.length === 0
)

/** 快速操作卡片 */
interface Suggestion {
  icon: string
  label: string
}

const suggestions: Suggestion[] = [
  { icon: '📰', label: '总结今天国内热点新闻' },
  { icon: '🤖', label: '总结最新 AI 发展现状' },
  { icon: '💻', label: '用 Python 写一个爬虫脚本' },
  { icon: '📝', label: '帮我润色一段文字' },
  { icon: '🐛', label: '帮我分析代码问题' },
  { icon: '🔍', label: '解释一个技术概念' }
]

/** 点击快速操作卡片 */
function onSuggestionClick(item: Suggestion) {
  prefillContent.value = item.label
}

/** 自动滚动到底部 */
function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}

/**
 * 消息渲染（统一）：
 * 流式与历史都走 buildRenderItems 折叠 —— 历史里的 assistant(tool_calls) + tool 消息
 * 若直接 v-for 会渲染成空气泡（表现为"回复变成多个 assistant 对话"）。
 * 区别只在最后一条 assistant：
 * - 流式中：注入实时 agentToolCalls（Store 里由 TOOL_START/TOOL_END 驱动）
 * - 历史中：注入 DB 折叠出的 tools
 */
const renderItems = computed(() => buildRenderItems(chatStore.messages))

/** 从渲染单元取出工具调用列表（assistant 才有，user 恒 undefined） */
function renderItemTools(item: RenderItem, index: number): AgentToolCallItem[] | undefined {
  if (item.kind !== 'assistant') return undefined
  // 流式中最后一条 assistant：注入实时 agentToolCalls；其余用 DB 折叠出的 tools
  if (index === renderItems.value.length - 1 && chatStore.isStreaming && chatStore.agentToolCalls.length > 0) {
    return chatStore.agentToolCalls
  }
  return item.tools
}

/** 判断指定渲染单元是否为错误状态 */
function isMessageError(index: number, role: string): boolean {
  return (
    role === 'assistant'
    && index === renderItems.value.length - 1
    && !chatStore.isStreaming
    && chatStore.streamError !== null
  )
}

// 监听消息变化，自动滚底
watch(
  () => chatStore.messages.length,
  () => scrollToBottom()
)

// 监听流式内容变化，自动滚底
watch(
  () => chatStore.streamContent,
  () => scrollToBottom()
)

// 监听流式错误 → toast 提示
watch(chatError, (newError) => {
  if (newError) {
    toast.add({
      title: newError || '流式请求失败',
      color: 'error',
      icon: 'i-lucide-alert-circle'
    })
  }
})
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 消息列表区域 -->
    <div
      ref="messagesContainer"
      class="flex-1 overflow-y-auto scroll-smooth"
    >
      <!-- 消息加载骨架屏 -->
      <div
        v-if="chatStore.messagesLoading"
        class="flex-1 overflow-y-auto"
      >
        <div class="max-w-3xl mx-auto py-4">
          <!-- 骨架消息 1：用户消息（右对齐，短） -->
          <div class="flex flex-col py-4 px-4">
            <div class="flex gap-3 flex-row-reverse">
              <USkeleton class="w-8 h-8 rounded-full shrink-0" />
              <USkeleton class="h-10 rounded-(--radius-lg) max-w-[45%] w-full" />
            </div>
          </div>

          <!-- 骨架消息 2：助手消息（左对齐，中长） -->
          <div class="flex flex-col py-4 px-4">
            <div class="flex gap-3">
              <USkeleton class="w-8 h-8 rounded-full shrink-0" />
              <USkeleton class="h-20 rounded-(--radius-lg) max-w-[65%] w-full" />
            </div>
          </div>

          <!-- 骨架消息 3：用户消息（右对齐，中） -->
          <div class="flex flex-col py-4 px-4">
            <div class="flex gap-3 flex-row-reverse">
              <USkeleton class="w-8 h-8 rounded-full shrink-0" />
              <USkeleton class="h-14 rounded-(--radius-lg) max-w-[55%] w-full" />
            </div>
          </div>

          <!-- 骨架消息 4：助手消息（左对齐，最长） -->
          <div class="flex flex-col py-4 px-4">
            <div class="flex gap-3">
              <USkeleton class="w-8 h-8 rounded-full shrink-0" />
              <USkeleton class="h-24 rounded-(--radius-lg) max-w-[70%] w-full" />
            </div>
          </div>
        </div>
      </div>

      <!-- 欢迎页 -->
      <div
        v-else-if="showWelcome"
        class="flex items-center justify-center h-full"
      >
        <div class="text-center max-w-2xl w-full px-4 sm:px-8 animate-fade-in">
          <UIcon
            name="i-lucide-sparkles"
            class="w-12 h-12 mx-auto mb-4 text-(--ui-primary)"
          />
          <h2 class="text-xl font-semibold mb-1 text-(--ui-text-highlighted)">
            👋 你好！我是你的私人AI助手
          </h2>
          <p class="text-sm text-(--ui-text-dimmed) mb-6">
            有什么可以帮助你的？
          </p>

          <!-- 快速操作卡片 -->
          <div class="welcome-suggestions">
            <button
              v-for="(item, idx) in suggestions"
              :key="idx"
              class="welcome-suggestion-card group"
              @click="onSuggestionClick(item)"
            >
              <span
                class="text-base"
                aria-hidden="true"
              >{{ item.icon }}</span>
              <span class="text-sm text-(--ui-text) truncate">{{ item.label }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 消息列表 -->
      <div
        v-else
        class="max-w-3xl mx-auto"
      >
        <!-- 统一渲染：流式与历史都通过 buildRenderItems 折叠，
             流式最后一条 assistant 注入实时 agentToolCalls -->
        <ChatMessage
          v-for="(item, index) in renderItems"
          :key="`msg-${index}`"
          :role="item.message.role"
          :content="item.message.content"
          :is-streaming="index === renderItems.length - 1 && chatStore.isStreaming"
          :has-error="isMessageError(index, item.message.role)"
          :is-initializing="index === renderItems.length - 1 && chatStore.isInitializing"
          :show-regenerate="index === renderItems.length - 1"
          :tools="renderItemTools(item, index)"
        />
      </div>
    </div>

    <!-- 底部输入区 -->
    <ChatInput
      :prefill="prefillContent"
      @prefill-consumed="prefillContent = ''"
    />
  </div>
</template>
