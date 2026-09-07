<script lang="ts" setup>
import { z } from 'zod'

const props = defineProps<{
  open: boolean
  kbId: string
}>()

const emit = defineEmits<{
  close: []
}>()

const ragStore = useRagStore()
const toast = useToast()

/** 服务端 content 上限（server/api/rag/schema.ts 对齐：500_000） */
const MAX_CONTENT_CHARS = 500_000

// ==================== Zod Schema ====================

const uploadSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(255, '标题不能超过 255 个字符')
})

type UploadFormState = z.infer<typeof uploadSchema>

// ==================== Modal 开关桥接 ====================

const modalOpen = computed({
  get: () => props.open,
  set: (v: boolean) => { if (!v) emit('close') }
})

// ==================== 状态 ====================

const fileInputRef = ref<HTMLInputElement | null>(null)
const formRef = ref()
const uploading = ref(false)

/** 已读取的原始 markdown 内容 */
const content = ref('')
/** 选中文件名（展示用） */
const fileName = ref('')

const formState = reactive<UploadFormState>({ title: '' })

/** Modal 打开时重置表单 */
watch(() => props.open, (isOpen) => {
  if (!isOpen) return
  content.value = ''
  fileName.value = ''
  formState.title = ''
  if (fileInputRef.value) fileInputRef.value.value = ''
  nextTick(() => formRef.value?.clear())
})

/** 选择 .md 文件 → 读入 content + 默认 title */
async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  try {
    const text = await file.text()
    if (text.length > MAX_CONTENT_CHARS) {
      toast.add({ title: `文件超过 ${MAX_CONTENT_CHARS / 1000}KB 上限，请精简内容后上传`, color: 'error', icon: 'i-lucide-alert-circle' })
      input.value = ''
      content.value = ''
      fileName.value = ''
      return
    }
    if (!text.trim()) {
      toast.add({ title: '文件内容为空', color: 'error', icon: 'i-lucide-alert-circle' })
      input.value = ''
      content.value = ''
      fileName.value = ''
      return
    }
    content.value = text
    fileName.value = file.name
    // 默认标题 = 文件名去 .md 后缀（用户可改，避免同名 409）
    formState.title = file.name.replace(/\.(md|markdown)$/i, '')
  } catch {
    toast.add({ title: '读取文件失败', color: 'error', icon: 'i-lucide-alert-circle' })
    input.value = ''
  }
}

// ==================== 提交 ====================

async function handleSubmit({ data }: { data: UploadFormState }) {
  if (!content.value) {
    toast.add({ title: '请先选择 .md 文件', color: 'warning', icon: 'i-lucide-alert-circle' })
    return
  }
  uploading.value = true
  try {
    const result = await ragStore.uploadDocument({
      kbId: props.kbId,
      title: data.title,
      content: content.value
    })
    toast.add({ title: `已入库，切成 ${result.chunkCount} 块`, color: 'success', icon: 'i-lucide-check' })
    emit('close')
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '上传失败'
    toast.add({ title: msg, color: 'error', icon: 'i-lucide-alert-circle' })
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="modalOpen"
    title="上传文档"
    :ui="{ content: 'sm:max-w-[560px]', footer: 'justify-end' }"
  >
    <template #body>
      <UForm
        ref="formRef"
        :schema="uploadSchema"
        :state="formState"
        class="space-y-4"
        @submit="handleSubmit"
      >
        <!-- 文件选择区（选中后转主色就绪态） -->
        <div
          class="flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center
                 transition-colors duration-(--duration-fast)"
          :class="content
            ? 'border-primary/50 bg-primary/5'
            : 'border-default hover:border-primary/40'"
        >
          <div
            class="w-10 h-10 rounded-full flex items-center justify-center transition-colors"
            :class="content ? 'bg-primary/10 text-primary' : 'bg-elevated text-dimmed'"
          >
            <UIcon
              :name="content ? 'i-lucide-file-check-2' : 'i-lucide-file-up'"
              class="w-5 h-5"
            />
          </div>
          <p
            class="text-sm max-w-full truncate"
            :class="content ? 'text-highlighted font-medium' : 'text-dimmed'"
          >
            {{ fileName || '选择 Markdown 文件，将自动分块并向量化入库' }}
          </p>
          <div class="flex items-center gap-2">
            <UButton
              size="sm"
              :color="content ? 'primary' : 'neutral'"
              variant="outline"
              icon="i-lucide-folder-open"
              @click="fileInputRef?.click()"
            >
              选择文件
            </UButton>
            <span
              v-if="content"
              class="text-xs text-dimmed"
            >
              {{ content.length.toLocaleString() }} 字符
            </span>
          </div>
          <input
            ref="fileInputRef"
            type="file"
            accept=".md,.markdown,text/markdown"
            class="hidden"
            @change="onFileChange"
          >
        </div>

        <UFormField
          name="title"
          label="标题"
          required
          hint="入库后展示的名称"
        >
          <UInput
            v-model="formState.title"
            placeholder="文档标题（默认取文件名）"
            variant="outline"
            class="w-full"
          />
        </UFormField>
      </UForm>
    </template>

    <template #footer>
      <UButton
        color="neutral"
        variant="ghost"
        :disabled="uploading"
        @click="emit('close')"
      >
        取消
      </UButton>
      <UButton
        color="primary"
        :loading="uploading"
        icon="i-lucide-upload"
        @click="formRef?.submit()"
      >
        上传
      </UButton>
    </template>
  </UModal>
</template>
