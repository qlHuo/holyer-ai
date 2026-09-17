<script setup lang="ts">
import type { CitationMeta } from '#shared/citation'
import { formatSourceLabel, isExternalSource } from '~/utils/citations'

/**
 * 回答末尾的「参考来源」列表（引用溯源 3.11）
 *
 * 编号与正文里的 chip **同源**：都由 MessageBody 的 buildCitationIndex 按
 * 「正文中首次出现的顺序」算出，这里只负责展示，不重新编号。
 * 只列正文真正引用到的片段 —— 检索到但没用上的不占号。
 */
defineProps<{
  /** 已按展示编号排好序的来源 */
  sources: CitationMeta[]
}>()

const emit = defineEmits<{
  /** 点击某条来源（payload 为短 key，上层负责分流） */
  select: [key: string]
}>()
</script>

<template>
  <div class="mt-3 pt-2.5 border-t border-default">
    <p class="flex items-center gap-1 text-xs text-dimmed mb-1">
      <UIcon
        name="i-lucide-book-open"
        class="size-3.5 shrink-0"
      />
      参考来源
    </p>

    <div class="flex flex-col">
      <UButton
        v-for="(s, i) in sources"
        :key="s.k"
        color="neutral"
        variant="ghost"
        size="xs"
        block
        class="justify-start gap-1.5"
        @click="emit('select', s.k)"
      >
        <span class="citation-chip">{{ i + 1 }}</span>
        <span class="flex-1 min-w-0 truncate text-left">{{ formatSourceLabel(s) }}</span>
        <UIcon
          v-if="isExternalSource(s)"
          name="i-lucide-arrow-up-right"
          class="size-3 shrink-0 opacity-60"
        />
      </UButton>
    </div>
  </div>
</template>
