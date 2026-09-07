<script lang="ts" setup>
import { z } from 'zod'
import type { KnowledgeBase } from '~~/shared/types/rag'

const props = defineProps<{
  open: boolean
  editingKb: KnowledgeBase | null
}>()

const emit = defineEmits<{
  close: []
}>()

const ragStore = useRagStore()
const toast = useToast()

// ==================== Zod Schema（镜像 server/api/rag/schema.ts） ====================

const kbFormSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100, '名称不能超过 100 个字符'),
  description: z.string().max(500, '描述最长500字符').default('')
})

type KbFormState = z.infer<typeof kbFormSchema>

// ==================== Modal 开关桥接 ====================

const modalOpen = computed({
  get: () => props.open,
  set: (v: boolean) => { if (!v) emit('close') }
})

// ==================== 表单状态 ====================

const formState = reactive<KbFormState>({
  name: '',
  description: ''
})

const formRef = ref()
const saving = ref(false)

/** Modal 打开时初始化/重置表单 */
watch(() => props.open, (isOpen) => {
  if (!isOpen) return
  if (props.editingKb) {
    formState.name = props.editingKb.name
    formState.description = props.editingKb.description
  } else {
    formState.name = ''
    formState.description = ''
  }
  // 清除上一次的校验错误
  nextTick(() => formRef.value?.clear())
})

// ==================== 提交 ====================

/** 校验通过后触发，由 UForm @submit 在 schema 校验通过时调用 */
async function handleSubmit({ data }: { data: KbFormState }) {
  saving.value = true
  try {
    if (props.editingKb) {
      await ragStore.updateKB(props.editingKb.id, data)
      toast.add({ title: '知识库已更新', color: 'success', icon: 'i-lucide-check' })
    } else {
      await ragStore.createKB(data)
      toast.add({ title: '知识库已创建', color: 'success', icon: 'i-lucide-check' })
    }
    emit('close')
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '保存失败'
    toast.add({ title: msg, color: 'error', icon: 'i-lucide-alert-circle' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="modalOpen"
    :title="editingKb ? '编辑知识库' : '新建知识库'"
    :ui="{ content: 'sm:max-w-[560px]', footer: 'justify-end' }"
  >
    <template #body>
      <UForm
        ref="formRef"
        :schema="kbFormSchema"
        :state="formState"
        class="space-y-4"
        @submit="handleSubmit"
      >
        <UFormField
          name="name"
          label="名称"
          required
        >
          <UInput
            v-model="formState.name"
            placeholder="例如：个人开发文档"
            variant="outline"
            class="w-full"
          />
        </UFormField>

        <UFormField
          name="description"
          label="描述"
        >
          <UTextarea
            v-model="formState.description"
            placeholder="简要描述这个知识库的用途（可选）"
            variant="outline"
            class="w-full"
            :rows="2"
            autoresize
          />
        </UFormField>
      </UForm>
    </template>

    <template #footer>
      <UButton
        color="neutral"
        variant="ghost"
        :disabled="saving"
        @click="emit('close')"
      >
        取消
      </UButton>
      <UButton
        color="primary"
        :loading="saving"
        @click="formRef?.submit()"
      >
        {{ editingKb ? '保存修改' : '创建' }}
      </UButton>
    </template>
  </UModal>
</template>
