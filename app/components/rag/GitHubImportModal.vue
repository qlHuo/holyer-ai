<script lang="ts" setup>
/**
 * GitHub 文档引入（roadmap 3.7 / M4）— 从公开 GitHub 仓库批量拉 .md 入库
 *
 * 流程：填 owner/repo → 列目录 → 勾选清单（行内改名 + 冲突预检 + 策略）→ 串行逐篇导入
 * 设计详见 docs/dev-log/2026-09-09-github-doc-import-plan.md
 *
 * 架构要点：
 * - 纯浏览器直连 GitHub（CORS *、零 token），仅上传走本系统 /api/rag/documents
 * - 批量 = 组件级运行态（不落库），串行逐篇、可停止、失败分型重试
 * - 409 冲突在循环前靠预检消化：覆盖策略传 overwrite=true（后端先新后删）
 */
import { z } from 'zod'
import RagApi from '~/api/rag'
import { ApiError } from '~/api/request'
import {
  fetchDefaultBranch,
  fetchMdTree,
  fetchRawFile,
  resolveImageUrls,
  GitHubError,
  type RepoFile
} from '~/utils/github'

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
const MAX_CONTENT = 500_000

// ==================== Modal 开关桥接 ====================

const modalOpen = computed({
  get: () => props.open,
  set: (v: boolean) => { if (!v) emit('close') }
})

// ==================== 表单 ====================

const formSchema = z.object({
  owner: z.string().trim().min(1, '请输入 GitHub 用户名/组织').max(100),
  repo: z.string().trim().min(1, '请输入仓库名').max(100),
  branch: z.string().trim().max(100).optional().or(z.literal('')),
  pathPrefix: z.string().trim().max(200).optional().or(z.literal(''))
})

type FormState = z.infer<typeof formSchema>

const formRef = ref()
const formState = reactive<FormState>({ owner: '', repo: '', branch: '', pathPrefix: '' })

/** 打开的仓库上下文（list/importing 阶段固定，防止运行中表单变化） */
const selectedRepo = reactive<{ owner: string, repo: string, branch: string }>({
  owner: '', repo: '', branch: ''
})

// ==================== 阶段与清单状态 ====================

/** form=填仓库信息；list=勾选清单；importing=批量导入中 */
const stage = ref<'form' | 'list' | 'importing'>('form')
const loadingTree = ref(false)
const treeError = ref('')
const treeTruncated = ref(false)
const search = ref('')

type ItemStatus = 'pending' | 'running' | 'success' | 'skipped' | 'failed'
type SkipReason = 'overlimit' | 'conflict'

interface ImportItem {
  path: string
  size: number
  title: string
  selected: boolean
  status: ItemStatus
  reason?: SkipReason
  message?: string
}

const items = ref<ImportItem[]>([])

/** 重名冲突策略：overwrite=覆盖（默认，后端 upsert）；skip=已存在则跳过不请求 */
type ConflictStrategy = 'overwrite' | 'skip'
const strategy = ref<ConflictStrategy>('overwrite')
const STRATEGY_OPTIONS = [
  { value: 'overwrite', label: '覆盖同名' },
  { value: 'skip', label: '跳过同名' }
]

// ==================== 派生 ====================

/** 目标库已有标题（预检 409 冲突源；页面进入时已 loadDocuments） */
const existingTitles = computed(() => new Set(ragStore.documents.map(d => d.title)))

/** 已勾选且待导入的行数（运行完成/跳过的行不计入，避免"已选"虚高） */
const selectedCount = computed(() => items.value.filter(i => i.selected && i.status === 'pending').length)

/** 可参与导入：pending 且已勾选且未锁（不在 skip 模式下与库内重名，未超限） */
function canRunNow(item: ImportItem): boolean {
  if (item.status !== 'pending' || !item.selected) return false
  if (item.size > MAX_CONTENT) return false
  return !(strategy.value === 'skip' && existingTitles.value.has(item.title))
}

const pendingCount = computed(() => items.value.filter(canRunNow).length)

/** 标题在已勾选待导入集合内重复 → 阻止导入直至改名（红标强制改，不靠覆盖兜底） */
function isTitleDup(item: ImportItem): boolean {
  if (!item.selected || item.status !== 'pending') return false
  return items.value.some(o => o !== item && o.selected && o.status === 'pending' && o.title === item.title)
}

const hasDupSelected = computed(() => items.value.some(isTitleDup))

const failedCount = computed(() => items.value.filter(i => i.status === 'failed').length)
const skippedCount = computed(() => items.value.filter(i => i.status === 'skipped').length)
const successCount = computed(() => items.value.filter(i => i.status === 'success').length)

/** 已运行过的行数（用于「继续导入」文案） */
const doneCount = computed(() => successCount.value + skippedCount.value + failedCount.value)

/** 运行中行数（串行，0 或 1） */
const runningCount = computed(() => items.value.filter(i => i.status === 'running').length)

/** 停止后留下的待执行行（勾选且未超限；skip 冲突行未勾选不计入） */
const leftoverCount = computed(() => items.value.filter(i =>
  i.status === 'pending' && i.selected && i.size <= MAX_CONTENT
).length)

/** 导入进度百分比：已完成 /（已完成 + 待执行 + 运行中） */
const progressPercent = computed(() => {
  const total = doneCount.value + leftoverCount.value + runningCount.value
  if (total === 0) return 0
  return Math.round(doneCount.value * 100 / total)
})

/** 可见行（搜索过滤） */
const visibleItems = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return items.value
  return items.value.filter(i => i.path.toLowerCase().includes(q) || i.title.toLowerCase().includes(q))
})

/** 运行中禁止交互的开关位 */
const lockedByRun = computed(() => stage.value === 'importing')

// ==================== Modal 生命周期 ====================

watch(() => props.open, (isOpen) => {
  if (!isOpen) {
    // 关闭时若仍在导入 → 请求停止（在途行回到 pending，重新打开可继续）
    if (stage.value === 'importing') requestStop()
    return
  }
  resetAll()
})

function resetAll() {
  stage.value = 'form'
  loadingTree.value = false
  treeError.value = ''
  treeTruncated.value = false
  search.value = ''
  items.value = []
  strategy.value = 'overwrite'
  selectedRepo.owner = ''
  selectedRepo.repo = ''
  selectedRepo.branch = ''
  formState.owner = ''
  formState.repo = ''
  formState.branch = ''
  formState.pathPrefix = ''
  nextTick(() => formRef.value?.clear())
}

// ==================== 1. 拉取清单 ====================

async function handleLoadTree({ data }: { data: FormState }) {
  loadingTree.value = true
  treeError.value = ''
  try {
    const owner = data.owner
    const repo = data.repo
    const branch = data.branch || await fetchDefaultBranch(owner, repo)
    selectedRepo.owner = owner
    selectedRepo.repo = repo
    selectedRepo.branch = branch

    const { files, truncated } = await fetchMdTree(owner, repo, branch)
    let list = files
    const prefix = (data.pathPrefix ?? '').replace(/\/+$/, '')
    if (prefix) {
      list = files.filter(f => f.path === prefix || f.path.startsWith(`${prefix}/`))
    }
    treeTruncated.value = truncated
    items.value = list.map(fileToItem)
    stage.value = 'list'
  } catch (error: unknown) {
    treeError.value = error instanceof Error ? error.message : '获取仓库文件失败'
  } finally {
    loadingTree.value = false
  }
}

function fileToItem(file: RepoFile): ImportItem {
  const title = file.path.replace(/\.(md|markdown)$/i, '')
  const selectable = file.size <= MAX_CONTENT && !(strategy.value === 'skip' && existingTitles.value.has(title))
  return {
    path: file.path,
    size: file.size,
    title,
    selected: selectable,
    status: 'pending'
  }
}

/** 策略切换：skip 模式下自动取消勾选「库内已有」行 */
watch(strategy, () => {
  if (strategy.value === 'skip') {
    for (const item of items.value) {
      if (existingTitles.value.has(item.title)) item.selected = false
    }
  }
})

function isLocked(item: ImportItem): boolean {
  if (lockedByRun.value) return true
  if (item.size > MAX_CONTENT) return true
  if (item.status !== 'pending') return true // 已运行的行不可再勾选/改名
  return strategy.value === 'skip' && existingTitles.value.has(item.title)
}

/** 行内冲突徽标 */
function chipOf(item: ImportItem): { text: string, color: 'neutral' | 'warning' | 'error' } | null {
  if (item.size > MAX_CONTENT) return { text: '超 500KB', color: 'neutral' }
  if (isTitleDup(item)) return { text: '标题重复', color: 'error' }
  if (existingTitles.value.has(item.title)) {
    if (strategy.value === 'skip') return { text: '已存在', color: 'neutral' }
    return item.selected ? { text: '将覆盖', color: 'warning' } : { text: '库内已有', color: 'neutral' }
  }
  return null
}

function toggleAll(checked: boolean) {
  for (const item of items.value) {
    if (!isLocked(item)) item.selected = checked
  }
}

/** UCheckbox 全选：value 可能是 'indeterminate'，只响应 true/false */
function onToggleAll(value: boolean | 'indeterminate') {
  toggleAll(value === true)
}

function clearSearch() {
  search.value = ''
}

// ==================== 2. 批量导入（串行运行态） ====================

const stopRequested = ref(false)
const abortController = ref<AbortController | null>(null)

async function startImport() {
  if (pendingCount.value === 0) return
  stage.value = 'importing'
  stopRequested.value = false
  abortController.value = new AbortController()
  const { owner, repo, branch } = selectedRepo

  // 快照待运行行（串行，循环内再按需改状态）
  const targets = items.value.filter(canRunNow)

  for (const item of targets) {
    if (stopRequested.value) break
    item.status = 'running'
    try {
      const raw = await fetchRawFile(owner, repo, branch, item.path, abortController.value?.signal)
      if (raw.length > MAX_CONTENT) {
        item.status = 'skipped'
        item.reason = 'overlimit'
        continue
      }
      const slashIdx = item.path.lastIndexOf('/')
      const dir = slashIdx >= 0 ? item.path.slice(0, slashIdx) : ''
      const content = resolveImageUrls(raw, { owner, repo, branch, dir })
      await RagApi.uploadDocument({
        kbId: props.kbId,
        title: item.title,
        content,
        sourceType: 'github',
        overwrite: strategy.value === 'overwrite'
      })
      item.status = 'success'
    } catch (error: unknown) {
      // 用户主动停止（含 abort 触发的 DOMException）：回到 pending，留给「继续导入」，不计失败
      if (stopRequested.value) {
        item.status = 'pending'
        item.message = undefined
        break
      }
      if (error instanceof GitHubError && error.status === 403) {
        // GitHub 限流：确定性失败，不重试
        item.status = 'failed'
        item.message = error.message
        break // 限流后继续只会全部失败
      }
      if (error instanceof ApiError && error.code === 'CONFLICT') {
        item.status = 'skipped'
        item.reason = 'conflict'
        item.message = error.message
        continue
      }
      item.status = 'failed'
      item.message = error instanceof Error ? error.message : '导入失败'
    }
  }

  const wasStopped = stopRequested.value
  abortController.value = null
  stopRequested.value = false
  stage.value = 'list'
  // 结束：统一刷新文档列表（避免 overwrite 后 store 残留旧 docId）
  await ragStore.loadDocuments(props.kbId)

  if (wasStopped) {
    toast.add({
      title: `已停止：成功 ${successCount.value}，剩 ${leftoverCount.value} 篇未执行`,
      color: 'info',
      icon: 'i-lucide-pause'
    })
    return
  }
  if (failedCount.value === 0) {
    toast.add({
      title: `导入完成：成功 ${successCount.value}，跳过 ${skippedCount.value}`,
      color: 'success',
      icon: 'i-lucide-check'
    })
  } else {
    toast.add({
      title: `导入完成：成功 ${successCount.value}，跳过 ${skippedCount.value}，失败 ${failedCount.value}`,
      color: 'error',
      icon: 'i-lucide-alert-circle'
    })
  }
}

function requestStop() {
  stopRequested.value = true
  abortController.value?.abort()
}

/** 失败项 → 恢复 pending 重新导入 */
function retryFailed() {
  for (const item of items.value) {
    if (item.status === 'failed') {
      item.status = 'pending'
      item.message = undefined
      item.reason = undefined
    }
  }
  startImport()
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <UModal
    v-model:open="modalOpen"
    :title="stage === 'form' ? '从 GitHub 引入文档' : '选择要导入的文档'"
    :description="stage !== 'form'
      ? `${selectedRepo.owner}/${selectedRepo.repo} · ${selectedRepo.branch} → 当前知识库`
      : '从公开仓库批量拉取 .md 文档，自动分块并向量化入库（仅支持公开仓库）'"
    :ui="{ content: 'sm:max-w-[720px]', footer: 'justify-end' }"
  >
    <template #body>
      <!-- ========== 1. 仓库表单 ========== -->
      <div
        v-if="stage === 'form'"
        class="flex flex-col gap-4"
      >
        <UForm
          ref="formRef"
          :schema="formSchema"
          :state="formState"
          class="space-y-4"
          @submit="handleLoadTree"
        >
          <UFormField
            name="owner"
            label="用户名 / 组织"
            required
          >
            <UInput
              v-model="formState.owner"
              placeholder="如 qlHuo"
              variant="outline"
              class="w-full"
            />
          </UFormField>
          <UFormField
            name="repo"
            label="仓库名"
            required
          >
            <UInput
              v-model="formState.repo"
              placeholder="如 holyer-ai"
              variant="outline"
              class="w-full"
            />
          </UFormField>
          <UFormField
            name="branch"
            label="分支（可留空 = 默认分支）"
          >
            <UInput
              v-model="formState.branch"
              placeholder="main"
              variant="outline"
              class="w-full"
            />
          </UFormField>
          <UFormField
            name="pathPrefix"
            label="目录前缀（可留空 = 全部）"
          >
            <UInput
              v-model="formState.pathPrefix"
              placeholder="docs"
              variant="outline"
              class="w-full"
            />
          </UFormField>
        </UForm>

        <p
          v-if="treeError"
          class="text-sm text-error-500 flex items-center gap-1.5"
        >
          <UIcon
            name="i-lucide-alert-circle"
            class="w-4 h-4 shrink-0"
          />
          {{ treeError }}
        </p>
      </div>

      <!-- ========== 2. 勾选清单 ========== -->
      <div
        v-else
        class="flex flex-col min-h-0"
      >
        <!-- 工具栏 -->
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-arrow-left"
            :disabled="lockedByRun"
            @click="resetAll"
          >
            返回修改
          </UButton>

          <div class="flex items-center gap-1 text-sm text-dimmed">
            <UCheckbox
              :model-value="visibleItems.length > 0 && visibleItems.every(i => !isLocked(i) ? i.selected : true)"
              :disabled="lockedByRun || visibleItems.length === 0"
              @update:model-value="onToggleAll"
            />
            <span>已选 {{ selectedCount }}/{{ items.length }}</span>
          </div>

          <div class="ml-auto flex items-center gap-2">
            <UInput
              v-model="search"
              size="sm"
              variant="outline"
              leading-icon="i-lucide-search"
              placeholder="过滤文件"
              class="w-48"
              :disabled="lockedByRun"
            />
          </div>
        </div>

        <!-- 冲突策略 -->
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-3">
          <span class="text-sm text-dimmed shrink-0">重名冲突</span>
          <URadioGroup
            v-model="strategy"
            :items="STRATEGY_OPTIONS"
            size="sm"
            :disabled="lockedByRun || doneCount > 0"
          />
          <span class="text-xs text-dimmed">
            {{ strategy === 'overwrite' ? '已存在文档将被新版替换' : '已存在文档不发起请求' }}
          </span>
        </div>

        <p
          v-if="treeTruncated"
          class="text-xs text-warning-500 mb-2"
        >
          仓库过大，文件清单可能不完整
        </p>
        <p
          v-if="hasDupSelected"
          class="text-xs text-error-500 mb-2 flex items-center gap-1.5"
        >
          <UIcon
            name="i-lucide-triangle-alert"
            class="w-3.5 h-3.5"
          />
          勾选行存在重复标题，请先改名（导入按钮已禁用）
        </p>

        <!-- 运行进度 / 汇总条 -->
        <div
          v-if="doneCount > 0 || stage === 'importing'"
          class="flex items-center gap-3 mb-3"
        >
          <div class="flex items-center gap-3 text-xs text-dimmed shrink-0">
            <span class="flex items-center gap-1 text-success-500 font-medium">
              <UIcon
                name="i-lucide-check-circle"
                class="w-3.5 h-3.5"
              />
              {{ successCount }}
            </span>
            <span class="flex items-center gap-1">
              <UIcon
                name="i-lucide-skip-forward"
                class="w-3.5 h-3.5"
              />
              {{ skippedCount }} 跳过
            </span>
            <span
              v-if="failedCount > 0"
              class="flex items-center gap-1 text-error-500 font-medium"
            >
              <UIcon
                name="i-lucide-alert-circle"
                class="w-3.5 h-3.5"
              />
              {{ failedCount }} 失败
            </span>
            <span
              v-if="stage === 'importing'"
              class="flex items-center gap-1 text-primary"
            >
              <UIcon
                name="i-lucide-loader-2"
                class="w-3.5 h-3.5 animate-spin"
              />
              {{ progressPercent }}%
            </span>
          </div>
          <UProgress
            :model-value="progressPercent"
            size="xs"
            class="flex-1"
          />
        </div>

        <!-- 清单滚动区 -->
        <div
          v-if="visibleItems.length > 0"
          class="overflow-y-auto border border-default divide-y divide-default min-h-64 max-h-104"
        >
          <div
            v-for="item in visibleItems"
            :key="item.path"
            class="flex items-center gap-2 px-3 py-2"
            :class="{ 'opacity-50': item.status === 'running' }"
          >
            <UCheckbox
              v-model="item.selected"
              :disabled="isLocked(item) || item.status !== 'pending'"
            />
            <div class="flex-1 min-w-0">
              <UInput
                v-model="item.title"
                size="xs"
                variant="outline"
                class="max-w-sm"
                :maxlength="255"
                :disabled="lockedByRun || item.status !== 'pending'"
              />
              <p
                class="text-xs text-dimmed mt-1 truncate"
                :title="item.path"
              >
                {{ item.path }} · {{ formatSize(item.size) }}
              </p>
            </div>

            <!-- 行内状态 / 冲突 -->
            <span
              v-if="item.status === 'running'"
              class="text-xs text-dimmed shrink-0 flex items-center gap-1"
            >
              <UIcon
                name="i-lucide-loader-2"
                class="w-3.5 h-3.5 animate-spin"
              />
              导入中
            </span>
            <span
              v-else-if="item.status === 'success'"
              class="text-xs text-success-500 shrink-0 flex items-center gap-1"
            >
              <UIcon
                name="i-lucide-check-circle"
                class="w-3.5 h-3.5"
              />
              成功
            </span>
            <span
              v-else-if="item.status === 'skipped'"
              class="text-xs text-dimmed shrink-0"
            >
              已跳过{{ item.reason === 'conflict' ? '（已存在）' : '' }}
            </span>
            <template v-else-if="item.status === 'failed'">
              <UTooltip :text="item.message ?? '导入失败'">
                <span class="text-xs text-error-500 shrink-0 cursor-help">失败</span>
              </UTooltip>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-rotate-ccw"
                title="重试"
                @click="item.status = 'pending'; item.message = undefined"
              />
            </template>
            <UBadge
              v-else-if="chipOf(item)"
              size="sm"
              :color="chipOf(item)!.color"
              variant="subtle"
              class="shrink-0"
            >
              {{ chipOf(item)!.text }}
            </UBadge>
          </div>
        </div>

        <!-- 空清单 -->
        <div
          v-else
          class="flex flex-col items-center justify-center py-12 text-dimmed gap-2"
        >
          <UIcon
            :name="items.length > 0 ? 'i-lucide-search-x' : 'i-lucide-folder-open'"
            class="w-8 h-8 opacity-25"
          />
          <p class="text-sm">
            {{ items.length > 0 ? `无匹配「${search}」的文件` : '该仓库没有可导入的 .md 文件' }}
          </p>
          <UButton
            v-if="items.length > 0"
            size="sm"
            color="neutral"
            variant="ghost"
            @click="clearSearch"
          >
            清空搜索
          </UButton>
          <UButton
            v-else
            size="sm"
            color="neutral"
            variant="ghost"
            @click="resetAll"
          >
            修改仓库信息
          </UButton>
        </div>

        <!-- 加载中 -->
        <div
          v-if="loadingTree"
          class="flex items-center justify-center gap-2 py-12 text-dimmed"
        >
          <UIcon
            name="i-lucide-loader-2"
            class="w-5 h-5 animate-spin"
          />
          正在获取仓库文件…
        </div>
      </div>
    </template>

    <!-- ========== 底部 ========== -->
    <template #footer>
      <template v-if="stage === 'importing'">
        <UButton
          color="error"
          variant="soft"
          icon="i-lucide-square"
          @click="requestStop"
        >
          停止
        </UButton>
      </template>
      <template v-else-if="stage === 'list' && items.length > 0">
        <UButton
          color="neutral"
          variant="ghost"
          @click="emit('close')"
        >
          取消
        </UButton>
        <UButton
          v-if="pendingCount > 0"
          color="primary"
          icon="i-lucide-upload"
          :disabled="hasDupSelected"
          @click="startImport"
        >
          {{ doneCount > 0 ? '继续导入' : '导入' }}（{{ pendingCount }} 篇）
        </UButton>
        <UButton
          v-else-if="failedCount > 0"
          color="primary"
          icon="i-lucide-rotate-ccw"
          @click="retryFailed"
        >
          重试失败项（{{ failedCount }}）
        </UButton>
        <UButton
          v-else
          color="primary"
          icon="i-lucide-check"
          @click="emit('close')"
        >
          完成
        </UButton>
      </template>
      <template v-else>
        <UButton
          color="neutral"
          variant="ghost"
          @click="emit('close')"
        >
          取消
        </UButton>
        <UButton
          color="primary"
          icon="i-lucide-folder-git-2"
          :loading="loadingTree"
          :disabled="!formState.owner || !formState.repo"
          @click="formRef?.submit()"
        >
          获取仓库文件
        </UButton>
      </template>
    </template>
  </UModal>
</template>
