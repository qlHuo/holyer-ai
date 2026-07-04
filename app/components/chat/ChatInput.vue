<script setup lang="ts">
const props = defineProps<{
  /** 预填充文本（欢迎页提示词点击传入） */
  prefill?: string
}>()

const emit = defineEmits<{
  'prefill-consumed': []
}>()

const { isSending, sendMessage, abort } = useChat()
const toast = useToast()

const input = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const textAreaRows = ref(1)

const MAX_CHARS = 50000

const canSend = computed(() => input.value.trim().length > 0 && !isSending.value)
const isOverLimit = computed(() => input.value.length > MAX_CHARS)

// ===== 预填充 =====
watch(
  () => props.prefill,
  (val) => {
    if (val) {
      input.value = val
      emit('prefill-consumed')
      nextTick(() => {
        autoResize()
        textareaRef.value?.focus()
      })
    }
  }
)

// ===== 自动扩展行数 =====
function autoResize() {
  const el = textareaRef.value
  if (!el) return
  el.rows = 1
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 21
  const paddingTop = parseFloat(getComputedStyle(el).paddingTop) || 0
  const paddingBottom = parseFloat(getComputedStyle(el).paddingBottom) || 0
  const contentHeight = el.scrollHeight - paddingTop - paddingBottom
  const lines = Math.min(Math.max(Math.ceil(contentHeight / lineHeight), 1), 8)
  el.rows = lines
  textAreaRows.value = lines
}

async function handleSend() {
  if (!canSend.value || isOverLimit.value) return

  const content = input.value
  input.value = ''
  await nextTick()
  autoResize()
  await sendMessage(content)
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item?.type.startsWith('image/')) {
        e.preventDefault()
        toast.add({
          title: '暂不支持粘贴图片',
          color: 'warning',
          icon: 'i-lucide-image'
        })
        return
      }
    }
  }

  const text = e.clipboardData?.getData('text/plain')
  if (text && input.value.length + text.length > MAX_CHARS) {
    nextTick(() => {
      if (input.value.length > MAX_CHARS) {
        input.value = input.value.slice(0, MAX_CHARS)
        autoResize()
      }
    })
  }
}

function handleStop() {
  abort()
}
</script>

<template>
  <div class="bg-(--ui-bg) px-4 py-3">
    <div class="max-w-3xl mx-auto">
      <!--
        统一输入卡片：textarea + 底部工具栏 都在同一边框内
        focus-within 让整个卡片在聚焦时高亮，形成"一个整体"的感知
      -->
      <div
        class="border rounded-(--radius-xl) bg-(--ui-bg) transition-colors duration-(--duration-fast) overflow-hidden"
        :class="[
          isOverLimit
            ? 'border-(--color-error-500)'
            : 'border-(--ui-border) focus-within:border-(--ui-primary) focus-within:shadow-sm'
        ]"
      >
        <!-- 上区：纯文本输入 -->
        <textarea
          ref="textareaRef"
          v-model="input"
          :rows="textAreaRows"
          :disabled="isSending"
          placeholder="有什么可以帮助你的？按 Enter 发送, Shift + Enter 换行"
          class="w-full resize-none border-none bg-transparent px-4 pt-3 pb-2 text-sm
                 placeholder:text-(--ui-text-dimmed) focus:outline-none
                 disabled:cursor-not-allowed disabled:opacity-50"
          @keydown="handleKeydown"
          @input="autoResize"
          @paste="handlePaste"
        />

        <!-- 底部分隔线（仅当内容多于 2 行或聚焦时更明显） -->
        <div
          class="mx-4 border-t border-(--ui-border) opacity-0 transition-opacity duration-(--duration-fast)"
          :class="{ 'opacity-100': textAreaRows >= 2 || input.length > 0 }"
        />

        <!-- 下区：工具栏（模型选择 + 发送/停止） -->
        <div class="flex items-center justify-between px-3 pb-3 pt-2">
          <!-- 左侧：模型选择 -->
          <div class="flex items-center gap-1">
            <ChatModelSelector />
          </div>

          <!-- 右侧：操作按钮 -->
          <div class="flex items-center gap-2">
            <span
              v-if="isOverLimit"
              class="text-xs text-(--color-error-500)"
            >
              {{ input.length }}/{{ MAX_CHARS }}
            </span>

            <UButton
              v-if="isSending"
              icon="i-lucide-square"
              color="neutral"
              variant="soft"
              size="sm"
              class="shrink-0"
              @click="handleStop"
            >
              停止
            </UButton>

            <UButton
              v-else
              icon="i-lucide-arrow-up"
              color="primary"
              size="sm"
              class="shrink-0"
              :disabled="!canSend"
              @click="handleSend"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
