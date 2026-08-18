<script setup lang="ts">
/**
 * 工具调用卡片 — 展示 Agent 工具调用的执行状态和结果
 *
 * 三态：
 * - running：旋转加载动画
 * - done：绿色对勾 + 结果摘要
 * - error：红色警告 + 错误信息
 */
defineProps<{
  toolName: string
  args: string
  status: 'running' | 'done' | 'error'
  result?: string
}>()

/** 工具名的中文友好显示 */
const TOOL_LABELS: Record<string, string> = {
  calculator: '计算器',
  web_search: '网络搜索',
  web_fetch: '网页抓取'
}

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name
}
</script>

<template>
  <div class="flex flex-col py-2 px-4">
    <div class="flex gap-3">
      <!-- 图标/状态 -->
      <div
        class="w-8 h-8 rounded-full shrink-0 flex items-center justify-center"
        :class="{
          'bg-(--ui-primary)/10 text-(--ui-primary)': status === 'running',
          'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400': status === 'done',
          'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400': status === 'error'
        }"
      >
        <UIcon
          v-if="status === 'running'"
          name="i-lucide-loader-circle"
          class="w-4 h-4 animate-spin"
        />
        <UIcon
          v-else-if="status === 'done'"
          name="i-lucide-check"
          class="w-4 h-4"
        />
        <UIcon
          v-else
          name="i-lucide-alert-triangle"
          class="w-4 h-4"
        />
      </div>

      <!-- 内容 -->
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 text-sm">
          <span
            class="font-medium"
            :class="{
              'text-(--ui-text-dimmed)': status === 'running',
              'text-(--ui-text)': status === 'done',
              'text-red-700 dark:text-red-400': status === 'error'
            }"
          >
            {{ status === 'running' ? `正在使用${toolLabel(toolName)}...`
              : status === 'done' ? `${toolLabel(toolName)} 完成`
                : `${toolLabel(toolName)} 出错` }}
          </span>
        </div>
        <p
          v-if="result"
          class="text-xs text-(--ui-text-dimmed) mt-0.5 line-clamp-3"
        >
          {{ result }}
        </p>
      </div>
    </div>
  </div>
</template>
