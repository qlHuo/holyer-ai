<script lang="ts" setup>
/**
 * ChatKnowledgeBaseSelector — 知识库 Pill（第三人称：检索范围）
 *
 * 与 ChatPromptSelector 同为 pill 形态，但面板比 USelectMenu 重：
 * 需要「模式单选（自动/不引用/指定）+ 库多选」两轴联动。
 *
 * 全部用 Nuxt UI 原生产品表达，不造组件：
 * - pill 触发按钮    → UButton（软态 pill，active/neutral 双色）
 * - 模式单选         → URadioGroup（auto/off/custom）
 * - 库多选           → UCheckboxGroup + #label slot（用 UCheckbox 的 label 插槽自定义行，
 *                       保留知识库彩色身份块 + 文档计数）
 *
 * 状态来自 rag.store（全局单值、跨对话 sticky，同 prompt 逻辑）：
 * - kbMode:  auto=LLM 自主检索全部（默认，中性灰低调）
 *            off=本次不引用
 *            custom=限定到指定库（primary 高亮）
 * - selectedKbIds: custom 模式下勾选的库
 */
import { kbAvatarClasses, kbInitial } from '~/utils/kbAvatar'
import type { KbReferenceMode } from '~~/shared/types/rag'

const ragStore = useRagStore()

// 聊天页不一定经过 /rag 触发过 getKBs；首次进入且未加载时拉一次（getKBs 防重入）
onMounted(() => {
  if (!ragStore.kbList.length) ragStore.getKBs()
})

// ==================== 模式 radio（Pinia state → 双向 v-model） ====================

const kbMode = computed({
  get: () => ragStore.kbMode,
  set: (v: KbReferenceMode) => ragStore.setKbMode(v)
})

const modeItems: Array<{ value: KbReferenceMode, label: string }> = [
  { value: 'auto', label: '自动检索' },
  { value: 'off', label: '不引用' },
  { value: 'custom', label: '指定知识库' }
]

// ==================== pill 状态 ====================

/** 唯一选中库的名字（pill 文案 n===1 时显示；避免为单名保留整份 activeKbs 派生） */
const singleActiveName = computed(() => {
  const id = ragStore.validSelectedKbIds[0]
  return id ? ragStore.kbList.find(kb => kb.id === id)?.name ?? '' : ''
})

/** pill 文案（三态） */
const pillLabel = computed(() => {
  if (ragStore.kbMode === 'off') return '知识库'
  if (ragStore.kbMode === 'custom') {
    const n = ragStore.validSelectedKbIds.length
    if (n === 0) return '知识库'
    if (n === 1) return `知识库·${singleActiveName.value}`
    return `知识库·${n} 个库`
  }
  // auto（默认）→ 低调中性，标注「自动」以区分「不引用」
  return '知识库·自动'
})

/** 是否高亮（仅 custom 且已选库时 primary；auto/off 中性灰） */
const isActive = computed(
  () => ragStore.kbMode === 'custom' && ragStore.validSelectedKbIds.length > 0
)

/** 非 custom 时库列表置灰禁用（此时检索范围不属于「指定」） */
const listDisabled = computed(() => ragStore.kbMode !== 'custom')

// ==================== 库多选（UCheckboxGroup items + #label slot） ====================

/** 给 UCheckboxGroup 的 items：value=库 id，label=库名，附带 identity 与计数 */
const kbItems = computed(() =>
  ragStore.kbList.map(kb => ({
    value: kb.id,
    label: kb.name,
    createdAt: kb.createdAt,
    docCount: kb.docCount
  }))
)

/** 选中数组：get 用与 kbList 取交集的 valid 集合（自动剔除被删库），set 整包覆盖 */
const checkedKbIds = computed({
  get: () => ragStore.validSelectedKbIds,
  set: (ids: string[]) => ragStore.setKbIds(ids)
})

// ==================== 操作 ====================

function selectAll() {
  ragStore.setKbIds(ragStore.kbList.map(kb => kb.id))
}
</script>

<template>
  <UPopover
    mode="click"
    :content="{ side: 'top', align: 'start', sideOffset: 6, collisionPadding: 8 }"
  >
    <!-- ========== Pill 触发按钮（UButton 软态 pill） ========== -->
    <UButton
      size="xs"
      variant="soft"
      :color="isActive ? 'primary' : 'neutral'"
      :icon="isActive ? 'i-lucide-database' : 'i-lucide-library'"
      :label="pillLabel"
      :ui="{ label: 'max-w-36 truncate' }"
      trailing-icon="i-lucide-chevron-down"
      class="shrink-0 rounded-full"
    />

    <!-- ========== 面板：模式 radio + 库多选 ========== -->
    <template #content>
      <div class="w-[min(76vw,20rem)]">
        <!-- 头部：标题 + 全选/清空 -->
        <div class="flex items-center justify-between px-3.5 py-2.5 border-b border-default">
          <div class="flex items-center gap-2 min-w-0">
            <UIcon
              name="i-lucide-database"
              class="w-3.5 h-3.5 text-primary shrink-0"
            />
            <span class="text-sm font-medium text-highlighted truncate">
              知识库
            </span>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <UButton
              v-if="ragStore.kbMode === 'custom'"
              size="xs"
              color="neutral"
              variant="ghost"
              @click="selectAll"
            >
              全选
            </UButton>
            <UButton
              v-if="ragStore.validSelectedKbIds.length"
              size="xs"
              color="neutral"
              variant="ghost"
              @click="ragStore.clearKbSelection()"
            >
              清空
            </UButton>
          </div>
        </div>

        <!-- 模式 radio -->
        <div class="px-3.5 py-2.5 border-b border-default">
          <URadioGroup
            v-model="kbMode"
            :items="modeItems"
          />
        </div>

        <!-- 库多选（custom 时可用） -->
        <div
          class="max-h-64 overflow-y-auto p-1.5"
          :class="listDisabled ? 'opacity-50 pointer-events-none' : ''"
        >
          <div
            v-if="ragStore.kbList.length === 0"
            class="px-3 py-6 text-center"
          >
            <UIcon
              name="i-lucide-database"
              class="w-6 h-6 mx-auto text-dimmed/30"
            />
            <p class="text-xs text-dimmed mt-2">
              暂无知识库
            </p>
            <NuxtLink
              to="/rag"
              class="text-xs text-primary hover:underline mt-1 inline-block"
            >
              去创建
            </NuxtLink>
          </div>

          <UCheckboxGroup
            v-else
            v-model="checkedKbIds"
            :items="kbItems"
          >
            <template #label="{ item }">
              <span class="flex items-center gap-2 w-full min-w-0">
                <span
                  class="w-5 h-5 rounded grid place-items-center text-[10px] font-semibold shrink-0"
                  :class="kbAvatarClasses(item.createdAt)"
                >
                  {{ kbInitial(item.label) }}
                </span>
                <span class="text-xs text-highlighted truncate flex-1 min-w-0">
                  {{ item.label }}
                </span>
                <span class="text-[10px] text-dimmed/70 tabular-nums shrink-0">
                  {{ item.docCount }} 个文档
                </span>
              </span>
            </template>
          </UCheckboxGroup>
        </div>
      </div>
    </template>
  </UPopover>
</template>
