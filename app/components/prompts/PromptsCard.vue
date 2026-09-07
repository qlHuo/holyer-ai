<script lang="ts" setup>
import type { PromptListItem } from '~~/shared/types/prompt'

const props = defineProps<{
  prompt: PromptListItem
}>()

const emit = defineEmits<{
  edit: [prompt: PromptListItem]
  delete: [prompt: PromptListItem]
}>()

/** 提示词正文字数（卡片底部元信息，对应知识库卡片的「N 篇」） */
const contentLength = computed(() => props.prompt.prompt.length)

function formatDate(isoStr: string): string {
  return new Date(isoStr).toLocaleDateString('zh-CN')
}
</script>

<template>
  <div
    class="flex flex-col h-full rounded-lg border border-default p-3.5 md:p-4 lg:p-5
           hover:border-primary hover:shadow-sm transition-colors duration-200
           cursor-pointer bg-default"
    @click="emit('edit', prompt)"
  >
    <!-- 卡片头部：名称 + 操作（常显，编辑用主题色） -->
    <div class="flex items-start justify-between gap-3 shrink-0">
      <h3
        class="font-semibold text-highlighted truncate flex-1 min-w-0 text-sm lg:text-base"
        :title="prompt.name"
      >
        {{ prompt.name }}
      </h3>
      <div class="flex items-center gap-0.5 shrink-0">
        <UButton
          icon="i-lucide-pencil"
          variant="ghost"
          size="xs"
          color="primary"
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

    <!-- 描述 — 最多两行 -->
    <p class="mt-2 text-sm text-dimmed leading-relaxed line-clamp-2">
      {{ prompt.description || '暂无描述' }}
    </p>

    <!-- 提示词内容预览 — 悬停展示全文 -->
    <div class="mt-3 shrink-0">
      <UPopover
        mode="hover"
        :open-delay="120"
        :close-delay="180"
        :content="{ side: 'top', align: 'start', sideOffset: 8, collisionPadding: 12 }"
      >
        <div class="group/prev relative cursor-help rounded-md bg-elevated p-2.5 md:p-3">
          <p
            class="text-xs text-dimmed line-clamp-2 font-mono leading-relaxed wrap-break-word"
          >
            {{ prompt.prompt }}
          </p>
          <!-- hover 查看全文提示 -->
          <div
            class="pointer-events-none absolute bottom-1 right-1 flex items-center rounded-md border border-default
                   bg-default/85 px-1 py-0.5 text-dimmed backdrop-blur-sm
                   opacity-0 transition-opacity duration-150 group-hover/prev:opacity-100"
          >
            <UIcon
              name="i-lucide-eye"
              class="w-3.5 h-3.5"
            />
          </div>
        </div>

        <!-- 全文面板（高度受控，内部滚动） -->
        <template #content>
          <div class="flex flex-col w-[min(78vw,30rem)] max-h-80 overflow-hidden">
            <div class="flex items-center justify-between gap-3 px-3.5 py-2.5 border-b border-default shrink-0">
              <div class="flex items-center gap-2 min-w-0">
                <UIcon
                  name="i-lucide-bookmark"
                  class="w-3.5 h-3.5 text-primary shrink-0"
                />
                <span class="text-sm font-medium text-highlighted truncate">
                  {{ prompt.name }}
                </span>
              </div>
              <span class="text-xs text-dimmed shrink-0">
                {{ contentLength.toLocaleString('zh-CN') }} 字
              </span>
            </div>
            <pre
              class="min-h-0 flex-1 overflow-y-auto px-3.5 py-3 text-xs font-mono leading-relaxed
                     whitespace-pre-wrap wrap-break-word text-default"
            >{{ prompt.prompt }}</pre>
          </div>
        </template>
      </UPopover>
    </div>

    <!-- 底部元信息：字数 chip + 更新时间（mt-auto 推底，各卡对齐） -->
    <div class="mt-auto pt-3 flex items-center justify-between gap-2 shrink-0">
      <UBadge
        size="sm"
        color="primary"
        variant="subtle"
        class="shrink-0"
      >
        {{ contentLength }} 字
      </UBadge>
      <span class="text-xs text-dimmed/70 truncate">
        {{ formatDate(prompt.updatedAt) }} 更新
      </span>
    </div>
  </div>
</template>
