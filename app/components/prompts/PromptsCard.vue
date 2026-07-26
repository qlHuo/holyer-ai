<script lang="ts" setup>
import type { PromptListItem } from '~~/shared/types/prompt'

defineProps<{
  prompt: PromptListItem
}>()

const emit = defineEmits<{
  edit: [prompt: PromptListItem]
  delete: [prompt: PromptListItem]
}>()

function formatDate(isoStr: string): string {
  return new Date(isoStr).toLocaleDateString('zh-CN')
}
</script>

<template>
  <div
    class="flex flex-col h-full rounded-(--radius-lg) border border-default p-3.5 md:p-4 lg:p-5
           hover:border-primary transition-all duration-200 group cursor-pointer bg-default"
    @click="emit('edit', prompt)"
  >
    <!-- 卡片头部 -->
    <div class="flex items-start justify-between gap-3 shrink-0">
      <h3 class="font-semibold text-highlighted truncate flex-1 text-sm lg:text-base">
        {{ prompt.name }}
      </h3>
      <div
        class="flex items-center gap-0.5 shrink-0 transition-opacity duration-150
               md:opacity-0 md:group-hover:opacity-100"
      >
        <UButton
          icon="i-lucide-pencil"
          variant="ghost"
          size="xs"
          color="neutral"
          title="编辑"
          @click.stop="emit('edit', prompt)"
        />
        <UButton
          icon="i-lucide-trash"
          variant="ghost"
          size="xs"
          color="error"
          title="删除"
          @click.stop="emit('delete', prompt)"
        />
      </div>
    </div>

    <!-- 描述 — 始终保留空间 -->
    <div class="mt-2 min-h-5 shrink-0">
      <p class="text-sm text-dimmed line-clamp-2">
        {{ prompt.description || '暂无描述' }}
      </p>
    </div>

    <!-- 提示词内容预览 -->
    <div class="mt-3 rounded-md bg-elevated p-2.5 md:p-3 shrink-0">
      <p class="text-xs text-(--ui-text-dimmed) line-clamp-3 font-mono leading-relaxed">
        {{ prompt.prompt }}
      </p>
    </div>

    <!-- 底部时间 — mt-auto 推到底 -->
    <p class="text-xs text-dimmed/60 mt-auto pt-3 shrink-0">
      {{ formatDate(prompt.updatedAt) }} 更新
    </p>
  </div>
</template>
