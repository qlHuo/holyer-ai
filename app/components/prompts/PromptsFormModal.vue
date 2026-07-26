<script lang="ts" setup>
import { z } from 'zod'
import type { PromptListItem } from '~~/shared/types/prompt'

const props = defineProps<{
  open: boolean
  editingPrompt: PromptListItem | null
}>()

const emit = defineEmits<{
  close: []
}>()

const promptStore = usePromptStore()
const toast = useToast()

// ==================== Zod Schema ====================

const promptFormSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100, '名称不能超过 100 个字符'),
  description: z.string().max(500, '描述最长500字符').default(''),
  prompt: z.string().min(1, '提示词内容不能为空')
})

type PromptFormState = z.infer<typeof promptFormSchema>

// ==================== Modal 开关桥接 ====================

const modalOpen = computed({
  get: () => props.open,
  set: (v: boolean) => { if (!v) emit('close') }
})

// ==================== 表单状态 ====================

const formState = reactive<PromptFormState>({
  name: '',
  description: '',
  prompt: ''
})

const formRef = ref()
const saving = ref(false)

/** Modal 打开时初始化/重置表单 */
watch(() => props.open, (isOpen) => {
  if (!isOpen) return
  if (props.editingPrompt) {
    formState.name = props.editingPrompt.name
    formState.description = props.editingPrompt.description
    formState.prompt = props.editingPrompt.prompt
  } else {
    formState.name = ''
    formState.description = ''
    formState.prompt = ''
  }
  // 清除上一次的校验错误
  nextTick(() => formRef.value?.clear())
})

// ==================== 提交 ====================

/** 校验通过后触发，由 UForm @submit 在 schema 校验通过时调用 */
async function handleSubmit({ data }: { data: PromptFormState }) {
  saving.value = true
  try {
    if (props.editingPrompt) {
      await promptStore.update(props.editingPrompt.id, data)
      toast.add({ title: '提示词已更新', color: 'success', icon: 'i-lucide-check' })
    } else {
      await promptStore.create(data)
      toast.add({ title: '提示词已创建', color: 'success', icon: 'i-lucide-check' })
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
    :title="editingPrompt ? '编辑提示词' : '新建提示词'"
    :ui="{ content: 'sm:max-w-[560px]' }"
  >
    <template #body>
      <UForm
        ref="formRef"
        :schema="promptFormSchema"
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
            placeholder="例如：代码审查专家"
            variant="outline"
            class="w-full"
          />
        </UFormField>

        <UFormField
          name="description"
          label="描述"
          hint="选填"
        >
          <UInput
            v-model="formState.description"
            placeholder="简要描述这个提示词的用途"
            variant="outline"
            class="w-full"
          />
        </UFormField>

        <UFormField
          name="prompt"
          label="提示词内容"
          required
        >
          <UTextarea
            v-model="formState.prompt"
            placeholder="输入提示词内容，例如：你是一个资深的代码审查专家，请帮我审查以下代码…"
            variant="outline"
            class="w-full"
            :rows="8"
          />
        </UFormField>
      </UForm>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
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
          {{ editingPrompt ? '保存修改' : '创建' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
