<script lang="ts" setup>
import { z } from 'zod'
import { MCP_HEADER_MASK } from '~~/shared/types/mcp'
import type { McpServerSummary, ProbeResult } from '~~/shared/types/mcp'

const props = defineProps<{
  open: boolean
  editingServer: McpServerSummary | null
}>()

const emit = defineEmits<{
  close: []
}>()

const mcpStore = useMcpStore()
const toast = useToast()

// ==================== 请求头解析（每行 "名称: 值"） ====================

const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

function parseHeaders(text: string): { headers: Record<string, string>, error: string | null } {
  const headers: Record<string, string> = {}

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue

    const index = line.indexOf(':')
    if (index <= 0) {
      return { headers: {}, error: `无法解析「${line}」，每行格式应为「名称: 值」` }
    }

    const name = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()

    if (!HEADER_NAME_RE.test(name)) {
      return { headers: {}, error: `请求头名称不合法：${name}` }
    }
    headers[name] = value
  }

  return { headers, error: null }
}

function formatHeaders(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n')
}

// ==================== Zod Schema（镜像 server/api/mcp/schema.ts） ====================

const mcpFormSchema = z.object({
  name: z.string().trim().min(1, '名称不能为空').max(100, '名称不能超过 100 个字符'),
  slug: z.string()
    .trim()
    .min(1, 'slug 不能为空')
    .max(20, 'slug 不能超过 20 个字符')
    .regex(/^[a-z0-9][a-z0-9_-]*$/i, '只能包含字母、数字、下划线和连字符，且以字母或数字开头'),
  url: z.string()
    .trim()
    .min(1, '地址不能为空')
    .max(2000, '地址过长')
    .refine((value) => {
      try {
        const url = new URL(value)
        return url.protocol === 'http:' || url.protocol === 'https:'
      } catch {
        return false
      }
    }, '仅支持 http:// 或 https:// 地址'),
  headersText: z.string().max(5000, '请求头内容过长').superRefine((value, ctx) => {
    const { error } = parseHeaders(value)
    if (error) ctx.addIssue({ code: 'custom', message: error })
  }),
  enabled: z.boolean()
})

type McpFormState = z.infer<typeof mcpFormSchema>

// ==================== Modal 开关桥接 ====================

const modalOpen = computed({
  get: () => props.open,
  set: (v: boolean) => { if (!v) emit('close') }
})

// ==================== 表单状态 ====================

const formState = reactive<McpFormState>({
  name: '',
  slug: '',
  url: '',
  headersText: '',
  enabled: false
})

const formRef = ref()
const saving = ref(false)
const probing = ref(false)
const probeResult = ref<ProbeResult | null>(null)

/** 地址变更后，已存的脱敏请求头不会随保存发往新地址，需要重新填写 */
const urlChanged = computed(() =>
  !!props.editingServer && formState.url.trim() !== props.editingServer.url
)
const hasMaskedHeaders = computed(() => formState.headersText.includes(MCP_HEADER_MASK))

/** Modal 打开时初始化 / 重置 */
watch(() => props.open, (isOpen) => {
  if (!isOpen) return

  if (props.editingServer) {
    formState.name = props.editingServer.name
    formState.slug = props.editingServer.slug
    formState.url = props.editingServer.url
    formState.headersText = formatHeaders(props.editingServer.headers)
    formState.enabled = props.editingServer.enabled
  } else {
    formState.name = ''
    formState.slug = ''
    formState.url = ''
    formState.headersText = ''
    formState.enabled = false
  }

  probeResult.value = null
  nextTick(() => formRef.value?.clear())
})

/** 地址或请求头变化后，之前的探测结果不再可信 */
watch(() => [formState.url, formState.headersText], () => {
  probeResult.value = null
})

// ==================== 测试连接 ====================

async function handleProbe() {
  const { headers, error } = parseHeaders(formState.headersText)
  if (error) {
    toast.add({ title: error, color: 'error', icon: 'i-lucide-alert-circle' })
    return
  }
  if (!formState.url.trim()) {
    toast.add({ title: '请先填写地址', color: 'error', icon: 'i-lucide-alert-circle' })
    return
  }

  probing.value = true
  probeResult.value = null
  try {
    probeResult.value = await mcpStore.probe({
      url: formState.url.trim(),
      headers,
      // 编辑已有 Server 时，服务端用已存值补齐脱敏的请求头
      serverId: props.editingServer?.id
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '测试连接失败'
    toast.add({ title: msg, color: 'error', icon: 'i-lucide-alert-circle' })
  } finally {
    probing.value = false
  }
}

// ==================== 提交 ====================

async function handleSubmit({ data }: { data: McpFormState }) {
  const { headers, error } = parseHeaders(data.headersText)
  if (error) {
    toast.add({ title: error, color: 'error', icon: 'i-lucide-alert-circle' })
    return
  }

  saving.value = true
  try {
    // 探测成功后一并保存快照，用户无需再点一次刷新
    const snapshot = probeResult.value?.ok
      ? {
          protocolVersion: probeResult.value.protocolVersion,
          serverInfo: probeResult.value.serverInfo,
          tools: probeResult.value.tools ?? []
        }
      : undefined

    if (props.editingServer) {
      await mcpStore.updateServer(props.editingServer.id, {
        name: data.name,
        url: data.url.trim(),
        headers,
        enabled: data.enabled,
        snapshot
      })
      toast.add({ title: 'MCP Server 已更新', color: 'success', icon: 'i-lucide-check' })
    } else {
      await mcpStore.createServer({
        name: data.name,
        slug: data.slug,
        url: data.url.trim(),
        headers,
        enabled: data.enabled,
        snapshot
      })
      toast.add({ title: 'MCP Server 已创建', color: 'success', icon: 'i-lucide-check' })
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
    :title="editingServer ? '编辑 MCP Server' : '接入 MCP Server'"
    :ui="{ content: 'sm:max-w-[620px]', footer: 'justify-end' }"
  >
    <template #body>
      <UForm
        ref="formRef"
        :schema="mcpFormSchema"
        :state="formState"
        class="space-y-4"
        @submit="handleSubmit"
      >
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <UFormField
            name="name"
            label="名称"
            required
          >
            <UInput
              v-model="formState.name"
              placeholder="例如：天气服务"
              variant="outline"
              class="w-full"
            />
          </UFormField>

          <UFormField
            name="slug"
            label="slug"
            required
            :hint="editingServer ? '创建后不可修改' : '参与工具命名，建议用英文短名'"
          >
            <UInput
              v-model="formState.slug"
              placeholder="例如：weather"
              variant="outline"
              class="w-full font-mono"
              :disabled="!!editingServer"
            />
          </UFormField>
        </div>

        <UFormField
          name="url"
          label="端点地址"
          required
          :hint="urlChanged && hasMaskedHeaders
            ? '地址已修改：已保存的请求头不会发往新地址，请重新填写'
            : 'Streamable HTTP 单端点，通常以 /mcp 结尾'"
        >
          <UInput
            v-model="formState.url"
            placeholder="https://example.com/mcp"
            variant="outline"
            class="w-full font-mono"
          />
        </UFormField>

        <UFormField
          name="headersText"
          label="请求头"
          hint="每行一个「名称: 值」，无需填写 Content-Type / Accept"
        >
          <UTextarea
            v-model="formState.headersText"
            placeholder="Authorization: Bearer xxx"
            variant="outline"
            class="w-full font-mono"
            :rows="3"
            autoresize
          />
        </UFormField>

        <UFormField
          name="enabled"
          label="启用"
          hint="启用后本次会话即可使用其工具（工具名格式 slug__tool）"
        >
          <USwitch v-model="formState.enabled" />
        </UFormField>

        <!-- 测试连接 -->
        <div class="space-y-2">
          <UButton
            size="sm"
            color="neutral"
            variant="outline"
            icon="i-lucide-plug-zap"
            :loading="probing"
            @click="handleProbe"
          >
            测试连接
          </UButton>

          <div
            v-if="probeResult"
            class="rounded-md border p-3 text-xs space-y-1"
            :class="probeResult.ok
              ? 'border-success-500/30 bg-success-500/5'
              : 'border-error-500/30 bg-error-500/5'"
          >
            <div
              class="flex items-center gap-2 font-medium"
              :class="probeResult.ok ? 'text-success-500' : 'text-error-500'"
            >
              <UIcon
                :name="probeResult.ok ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'"
                class="w-4 h-4 shrink-0"
              />
              {{ probeResult.ok ? '连接成功' : '连接失败' }}
            </div>
            <p
              v-if="probeResult.ok"
              class="text-dimmed"
            >
              协议 {{ probeResult.protocolVersion || '未知' }} · {{ probeResult.tools?.length ?? 0 }} 个工具
              <template v-if="probeResult.serverInfo?.name">
                · {{ probeResult.serverInfo.name }} {{ probeResult.serverInfo.version }}
              </template>
            </p>
            <p
              v-else
              class="text-dimmed"
            >
              {{ probeResult.error?.message }}
            </p>
            <p
              v-if="probeResult.ok && probeResult.tools?.length"
              class="text-dimmed/80 font-mono truncate"
              :title="probeResult.tools?.map(tool => tool.name).join(', ')"
            >
              {{ probeResult.tools?.map(tool => tool.name).join(', ') }}
            </p>
          </div>
        </div>
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
        {{ editingServer ? '保存修改' : '创建' }}
      </UButton>
    </template>
  </UModal>
</template>
