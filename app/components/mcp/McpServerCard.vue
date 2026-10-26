<script lang="ts" setup>
import type { McpServerSummary } from '~~/shared/types/mcp'

const props = defineProps<{
  server: McpServerSummary
  refreshing?: boolean
}>()

const emit = defineEmits<{
  edit: [server: McpServerSummary]
  delete: [server: McpServerSummary]
  refresh: [server: McpServerSummary]
  toggleEnabled: [server: McpServerSummary, value: boolean]
  toggleTool: [server: McpServerSummary, toolName: string, enabled: boolean]
}>()

const showTools = ref(false)

const enabledToolCount = computed(() =>
  props.server.tools.filter(tool => !props.server.disabledTools.includes(tool.name)).length
)

function isToolEnabled(toolName: string): boolean {
  return !props.server.disabledTools.includes(toolName)
}

function formatDate(isoStr: string | null): string {
  if (!isoStr) return '从未'
  return new Date(isoStr).toLocaleDateString('zh-CN')
}
</script>

<template>
  <div
    class="flex flex-col h-full rounded-lg border border-default p-3.5 bg-default
           hover:border-primary hover:shadow-sm transition-colors duration-200"
  >
    <!-- 头部：身份块 + 名称 + slug + 启停 -->
    <div class="flex items-center gap-2.5 shrink-0">
      <div class="shrink-0 w-8 h-8 rounded-md bg-primary/10 text-primary flex items-center justify-center">
        <UIcon
          name="i-lucide-server"
          class="w-4 h-4"
        />
      </div>
      <h3
        class="flex-1 min-w-0 font-semibold text-sm text-highlighted truncate leading-snug"
        :title="server.name"
      >
        {{ server.name }}
      </h3>
      <UBadge
        size="sm"
        color="neutral"
        variant="subtle"
        class="shrink-0 font-mono"
      >
        {{ server.slug }}
      </UBadge>
      <USwitch
        size="sm"
        :model-value="server.enabled"
        :aria-label="server.enabled ? '停用' : '启用'"
        @update:model-value="emit('toggleEnabled', server, $event)"
      />
    </div>

    <!-- 地址 -->
    <p
      class="mt-1.5 text-xs text-dimmed font-mono truncate"
      :title="server.url"
    >
      {{ server.url }}
    </p>

    <!-- 最近一次刷新错误 -->
    <p
      v-if="server.lastError"
      class="mt-1 text-xs text-error-500 line-clamp-2"
      :title="server.lastError"
    >
      {{ server.lastError }}
    </p>

    <!-- 元信息 -->
    <div class="mt-2 flex items-center gap-1.5 flex-wrap">
      <UBadge
        v-if="server.protocolVersion"
        size="sm"
        color="neutral"
        variant="subtle"
      >
        {{ server.protocolVersion }}
      </UBadge>
      <UBadge
        size="sm"
        color="primary"
        variant="subtle"
      >
        {{ enabledToolCount }} / {{ server.tools.length }} 个工具
      </UBadge>
    </div>

    <!-- 底部操作 -->
    <div class="mt-auto pt-2.5 flex items-center justify-between gap-2 shrink-0">
      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        :icon="showTools ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        @click="showTools = !showTools"
      >
        工具列表
      </UButton>

      <div class="flex items-center gap-0.5 shrink-0">
        <UButton
          icon="i-lucide-refresh-cw"
          variant="ghost"
          size="xs"
          color="neutral"
          title="刷新工具"
          :loading="refreshing"
          @click="emit('refresh', server)"
        />
        <UButton
          icon="i-lucide-pencil"
          variant="ghost"
          size="xs"
          color="primary"
          title="编辑"
          @click="emit('edit', server)"
        />
        <UButton
          icon="i-lucide-trash"
          variant="ghost"
          size="xs"
          color="error"
          title="删除"
          @click="emit('delete', server)"
        />
      </div>
    </div>

    <!-- 工具列表（按原始工具名逐个启停） -->
    <div
      v-if="showTools"
      class="mt-2 pt-2 border-t border-default space-y-2"
    >
      <p
        v-if="server.tools.length === 0"
        class="text-xs text-dimmed"
      >
        尚未获取工具，点击刷新
      </p>
      <div
        v-for="tool in server.tools"
        :key="tool.name"
        class="flex items-start gap-2"
      >
        <UCheckbox
          class="mt-0.5"
          :model-value="isToolEnabled(tool.name)"
          :aria-label="tool.name"
          @update:model-value="emit('toggleTool', server, tool.name, $event === true)"
        />
        <div class="min-w-0 flex-1">
          <p class="text-xs font-medium text-highlighted font-mono truncate">
            {{ tool.name }}
          </p>
          <UPopover
            v-if="tool.description"
            mode="hover"
            :open-delay="120"
            :close-delay="180"
            :content="{ side: 'top', align: 'start', sideOffset: 8, collisionPadding: 12 }"
          >
            <p class="text-xs text-dimmed line-clamp-2 cursor-help">
              {{ tool.description }}
            </p>
            <template #content>
              <div class="w-[min(78vw,24rem)] max-h-64 overflow-y-auto p-3">
                <p class="text-xs text-default whitespace-pre-wrap wrap-break-word">
                  {{ tool.description }}
                </p>
              </div>
            </template>
          </UPopover>
        </div>
      </div>
      <p class="text-xs text-dimmed/70">
        更新于 {{ formatDate(server.toolsFetchedAt) }}
      </p>
    </div>
  </div>
</template>
