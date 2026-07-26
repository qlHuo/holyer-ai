<script lang="ts" setup>
/**
 * ChatPromptSelector — Persona Pill
 *
 * 提示词是 AI 的"人格切换器"，不是普通设置项。
 * 基于 Nuxt UI v4 USelectMenu，pill 触发按钮通过 #default slot 定制，
 * 下拉菜单、键盘导航、无障碍访问由 Reka UI 提供。
 */
const promptStore = usePromptStore()

// ==================== 选项列表 ====================
const selectItems = computed(() => {
  const items: Array<Record<string, unknown>> = [

  ]
  if (promptStore.list.length > 0) {
    items.push(...promptStore.list.map(p => ({
      label: p.name,
      value: p.id,
      description: p.description || '暂无描述'
    })))
  }
  return items
})

const activePrompt = computed(() => promptStore.selectedPrompt)

// ==================== 事件处理 ====================
function handleClear() {
  promptStore.selectedPromptId = null
}
</script>

<template>
  <USelectMenu
    v-model="promptStore.selectedPromptId"
    :items="selectItems"
    value-key="value"
    :search-input="false"
    :content="{ side: 'top', sideOffset: 6, collisionPadding: 8 }"
    size="xs"
    color="neutral"
    variant="soft"
    :ui="{
      base: '!bg-transparent !border-0 !p-0 !shadow-none !ring-0 !min-h-0 !rounded-full',
      content: 'w-72',
      leading: 'hidden',
      trailing: 'hidden'
    }"
  >
    <!-- ========== Pill 触发按钮 ========== -->
    <template #default="{ open }">
      <span
        class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs
               font-medium leading-none transition-all select-none shrink-0"
        :class="activePrompt
          ? [
            'border-(--ui-primary)/30 bg-(--ui-primary)/8 text-(--ui-primary)',
            'hover:bg-(--ui-primary)/12 hover:border-(--ui-primary)/40',
            'shadow-[0_0_8px_-3px_var(--ui-primary)]'
          ]
          : [
            'border-(--ui-border) bg-(--ui-bg-elevated)/60 text-(--ui-text-dimmed)',
            'hover:border-(--ui-border)/80 hover:text-(--ui-text) hover:bg-(--ui-bg-elevated)'
          ]"
      >
        <UIcon
          :name="activePrompt ? 'i-lucide-sparkles' : 'i-lucide-bookmark'"
          class="w-3 h-3 shrink-0 transition-transform duration-300"
          :class="{ 'scale-110': activePrompt }"
        />
        <span class="max-w-28 truncate">{{ activePrompt?.name ?? '提示词' }}</span>

        <!-- 清除按钮（选中态显示在 pill 内） -->
        <button
          v-if="activePrompt"
          type="button"
          class="shrink-0 rounded-full p-0.5 -mr-0.5
                 text-(--ui-primary)/60 hover:text-(--ui-primary)
                 hover:bg-(--ui-primary)/10 transition-colors"
          tabindex="-1"
          @click.stop.prevent="handleClear"
        >
          <UIcon
            name="i-lucide-x"
            class="w-2.5 h-2.5"
          />
        </button>

        <UIcon
          name="i-lucide-chevron-down"
          class="w-3 h-3 shrink-0 transition-transform duration-200"
          :class="{ 'rotate-180': open }"
        />
      </span>
    </template>

    <!-- ========== 头部：标题 + 计数 ========== -->
    <template #content-top>
      <div class="flex items-center justify-between px-3 py-2 border-b border-(--ui-border)">
        <span class="text-xs text-(--ui-text-dimmed) font-medium">选择提示词</span>
        <span
          v-if="promptStore.list.length > 0"
          class="text-[10px] text-(--ui-text-dimmed)/60 tabular-nums"
        >{{ promptStore.list.length }} 个可用</span>
      </div>
    </template>

    <!-- ========== 空状态 ========== -->
    <template #empty>
      <div class="px-3 py-6 text-center">
        <UIcon
          name="i-lucide-bookmark"
          class="w-6 h-6 mx-auto text-(--ui-text-dimmed)/30"
        />
        <p class="text-xs text-(--ui-text-dimmed) mt-2">
          暂无自定义提示词
        </p>
        <NuxtLink
          to="/prompts"
          class="text-xs text-(--ui-primary) hover:underline mt-1 inline-block"
        >
          去创建
        </NuxtLink>
      </div>
    </template>
  </USelectMenu>
</template>
