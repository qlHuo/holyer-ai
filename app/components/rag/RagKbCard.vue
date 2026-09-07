<script lang="ts" setup>
import type { KnowledgeBase } from '~~/shared/types/rag'
import { kbInitial, kbAvatarClasses } from '~/utils/kbAvatar'

const props = defineProps<{
  kb: KnowledgeBase
}>()

const emit = defineEmits<{
  open: [kb: KnowledgeBase]
  edit: [kb: KnowledgeBase]
  delete: [kb: KnowledgeBase]
}>()

const avatarChar = computed(() => kbInitial(props.kb.name))
const avatarClass = computed(() => kbAvatarClasses(props.kb.createdAt))

function formatDate(isoStr: string): string {
  return new Date(isoStr).toLocaleDateString('zh-CN')
}
</script>

<template>
  <div
    class="flex flex-col h-full rounded-lg border border-default p-3.5
           hover:border-primary hover:shadow-sm
           transition-colors duration-200 group cursor-pointer bg-default"
    @click="emit('open', kb)"
  >
    <!-- 卡片头部：首字母身份块 + 名称 + 操作 -->
    <div class="flex items-center gap-2.5 shrink-0">
      <div
        class="shrink-0 w-8 h-8 rounded-md text-sm font-semibold flex items-center justify-center select-none"
        :class="avatarClass"
      >
        {{ avatarChar }}
      </div>
      <h3
        class="flex-1 min-w-0 font-semibold text-sm text-highlighted truncate leading-snug"
        :title="kb.name"
      >
        {{ kb.name }}
      </h3>
      <!-- 操作（常显；编辑用主题色） -->
      <div class="flex items-center gap-0.5 shrink-0">
        <UButton
          icon="i-lucide-pencil"
          variant="ghost"
          size="xs"
          color="primary"
          title="编辑"
          @click.stop="emit('edit', kb)"
        />
        <UButton
          icon="i-lucide-trash"
          variant="ghost"
          size="xs"
          color="error"
          title="删除"
          @click.stop="emit('delete', kb)"
        />
      </div>
    </div>

    <!-- 描述（主题内容，最多两行）— flex-1 填充保证底部贴齐、各卡等高 -->
    <p class="mt-2 flex-1 text-sm text-dimmed leading-relaxed line-clamp-2 min-h-0">
      {{ kb.description || '暂无描述' }}
    </p>

    <!-- 底部：文档数 tag（弱化）+ 更新时间（右下角） -->
    <div class="mt-2.5 flex items-center justify-between gap-2 shrink-0">
      <UBadge
        size="sm"
        color="primary"
        variant="subtle"
        class="shrink-0"
      >
        {{ kb.docCount }} 篇
      </UBadge>
      <span class="text-xs text-dimmed/70 truncate">
        {{ formatDate(kb.updatedAt) }} 更新
      </span>
    </div>
  </div>
</template>
