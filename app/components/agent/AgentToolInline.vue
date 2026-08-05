<script setup lang="ts">
/**
 * AgentToolInline — Agent 工具调用卡片指示器 (V3)
 *
 * 设计方向：参考 Dify / ChatGPT 风格，白色圆角卡片展示工具调用过程。
 * - 聚合头「已使用 N 个工具」可整体折叠/展开
 * - 每张卡片：工具图标 + 名称 + 状态（running/done/error）+ 耗时 + 展开箭头
 * - 展开后显示「输入」和「输出」两栏
 * - 流结束后工具卡片保留（不随 finishStreaming 清空），新流开始时清空
 */

const chatStore = useChatStore()

/** 工具元数据：中文标签 + Lucide 图标 */
const TOOL_META: Record<string, { label: string, icon: string }> = {
  web_search: { label: '网络搜索', icon: 'i-lucide-search' },
  web_fetch: { label: '网页抓取', icon: 'i-lucide-globe' },
  calculator: { label: '计算器', icon: 'i-lucide-calculator' },
  current_time: { label: '当前时间', icon: 'i-lucide-clock' }
}

/** 整个工具区块是否折叠（聚合头控制） */
const sectionCollapsed = ref(false)

/** 当前展开详情的工具 ID（单开模式） */
const expandedId = ref<string | null>(null)

function toolMeta(name: string) {
  return TOOL_META[name] ?? { label: name, icon: 'i-lucide-wrench' }
}

function toggleSection() {
  sectionCollapsed.value = !sectionCollapsed.value
}

function toggleCard(id: string) {
  expandedId.value = expandedId.value === id ? null : id
}

/** 格式化耗时：<1s 显示 ms，否则显示 s */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 1000)}s`
}

/**
 * 格式化 args JSON 字符串为可读形式。
 * 单字段对象直接显示值，多字段缩进展示。
 */
function formatArgs(args: string): string {
  try {
    const parsed = JSON.parse(args)
    const keys = Object.keys(parsed)
    if (keys.length === 1) return String(parsed[keys[0]!])
    return JSON.stringify(parsed, null, 2)
  } catch {
    return args
  }
}

/** 聚合头文案 */
const headerText = computed(() => {
  const total = chatStore.agentToolCalls.length
  if (total === 0) return ''
  const doneCount = chatStore.agentToolCalls.filter(t => t.status !== 'running').length
  if (doneCount === total) return `已使用 ${total} 个工具`
  return `正在使用工具…（${doneCount}/${total}）`
})

/** 全部工具完成后，自动展开第一张卡片 */
// watch(
//   () => {
//     const calls = chatStore.agentToolCalls
//     return calls.length > 0 && calls.every(tc => tc.status !== 'running')
//   },
//   (allDone) => {
//     if (allDone && chatStore.agentToolCalls.length > 0 && expandedId.value === null) {
//       const first = chatStore.agentToolCalls[0]
//       if (first) expandedId.value = first.id
//     }
//   }
// )
</script>

<template>
  <div
    v-if="chatStore.agentToolCalls.length > 0"
    class="tool-section"
  >
    <!-- 聚合头：「已使用 N 个工具」+ 折叠箭头 -->
    <button
      class="tool-section-header"
      @click="toggleSection"
    >
      <span>{{ headerText }}</span>
      <UIcon
        :name="sectionCollapsed ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"
        class="tool-section-chevron"
      />
    </button>

    <!-- 工具卡片列表（聚合头折叠时隐藏） -->
    <div
      v-if="!sectionCollapsed"
      class="tool-card-list"
    >
      <div
        v-for="tc in chatStore.agentToolCalls"
        :key="tc.id"
        class="tool-card"
      >
        <!-- 卡片头部（始终可见） -->
        <button
          class="tool-card-header"
          :class="{ 'tool-card-header--clickable': tc.status !== 'running' }"
          :disabled="tc.status === 'running'"
          @click="tc.status !== 'running' ? toggleCard(tc.id) : undefined"
        >
          <!-- 工具类型图标 -->
          <UIcon
            :name="toolMeta(tc.name).icon"
            class="tool-type-icon"
          />

          <!-- 工具名称 -->
          <span class="tool-name">{{ toolMeta(tc.name).label }}</span>

          <!-- 右侧：状态图标 + 耗时 + 展开箭头 -->
          <span class="tool-status-group">
            <!-- running：旋转加载 -->
            <UIcon
              v-if="tc.status === 'running'"
              name="i-lucide-loader-circle"
              class="tool-status-icon animate-spin status-running"
            />
            <!-- done：绿色对勾 + 耗时 -->
            <template v-else-if="tc.status === 'done'">
              <UIcon
                name="i-lucide-check"
                class="tool-status-icon status-done"
              />
              <span
                v-if="tc.durationMs !== undefined"
                class="tool-duration"
              >{{ formatDuration(tc.durationMs) }}</span>
            </template>
            <!-- error：红色警告 + 耗时 -->
            <template v-else>
              <UIcon
                name="i-lucide-alert-triangle"
                class="tool-status-icon status-error"
              />
              <span
                v-if="tc.durationMs !== undefined"
                class="tool-duration"
              >{{ formatDuration(tc.durationMs) }}</span>
            </template>

            <!-- 展开箭头（仅 done/error 可点击展开） -->
            <UIcon
              v-if="tc.status !== 'running'"
              name="i-lucide-chevron-down"
              class="tool-expand-chevron"
              :class="{ 'rotate-180': expandedId === tc.id }"
            />
          </span>
        </button>

        <!-- 展开详情：输入 + 输出 -->
        <div
          v-if="expandedId === tc.id && tc.status !== 'running'"
          class="tool-card-detail"
        >
          <div class="tool-detail-block">
            <div class="tool-detail-label">
              输入
            </div>
            <pre class="tool-detail-content">{{ formatArgs(tc.args) }}</pre>
          </div>
          <div class="tool-detail-block">
            <div class="tool-detail-label">
              输出
            </div>
            <pre class="tool-detail-content">{{ tc.result || '（无输出）' }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ==================== 容器 ==================== */
.tool-section {
  padding: 0 0 8px 0; /* 无左内边距 — 由父 ChatMessage flex 容器（avatar + gap）对齐气泡左缘 */
}

/* ==================== 聚合头 ==================== */
.tool-section-header {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--ui-text-dimmed);
  transition: color var(--duration-fast) var(--ease-out);
}

.tool-section-header:hover {
  color: var(--ui-text);
}

.tool-section-chevron {
  width: 12px;
  height: 12px;
  opacity: 0.5;
}

/* ==================== 卡片列表 ==================== */
.tool-card-list {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ==================== 单张卡片 ==================== */
.tool-card {
  border: 1px solid var(--ui-border);
  border-radius: var(--radius-md);
  background: var(--ui-bg-elevated);
  overflow: hidden;
}

/* ==================== 卡片头部 ==================== */
.tool-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: none;
  cursor: default;
  font-size: 13px;
  color: var(--ui-text);
}

.tool-card-header--clickable {
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}

.tool-card-header--clickable:hover {
  background: color-mix(in srgb, var(--ui-bg) 60%, transparent);
}

/* 工具类型图标 */
.tool-type-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--ui-text-dimmed);
}

/* 工具名称 */
.tool-name {
  flex: 1;
  text-align: left;
  font-weight: var(--font-medium);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ==================== 状态组（右侧） ==================== */
.tool-status-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

/* 状态图标基础 */
.tool-status-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.status-running {
  color: var(--ui-primary);
}

.status-done {
  color: var(--color-success-500);
}

.status-error {
  color: var(--color-error-500);
}

/* 耗时文字 */
.tool-duration {
  font-size: 12px;
  color: var(--ui-text-dimmed);
  font-variant-numeric: tabular-nums;
}

/* 展开箭头 */
.tool-expand-chevron {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  color: var(--ui-text-dimmed);
  opacity: 0.5;
  transition: transform var(--duration-base) var(--ease-out);
}

/* ==================== 展开详情 ==================== */
.tool-card-detail {
  border-top: 1px solid var(--ui-border);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tool-detail-label {
  font-size: 11px;
  color: var(--ui-text-dimmed);
  margin-bottom: 4px;
  font-weight: var(--font-medium);
}

.tool-detail-content {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--ui-bg);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--ui-text);
  max-height: 160px;
  overflow-y: auto;
  font-family: var(--font-mono);
}
</style>
