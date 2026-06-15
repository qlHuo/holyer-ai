<script lang='ts' setup>
defineProps({
  showMenuButton: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['toggle-sidebar'])
const { isDark, toggleMode } = useTheme()
</script>

<template>
  <header class="flex items-center justify-between h-14 px-4 border-b border-(--ui-border) bg-(--ui-bg)">
    <div class="flex items-center gap-3">
      <!-- 移动端菜单按钮 -->
      <UButton
        v-if="showMenuButton"
        icon="i-lucide-menu"
        variant="ghost"
        size="sm"
        color="neutral"
        @click="emit('toggle-sidebar')"
      />

      <h1 class="text-lg font-semibold text-(--ui-text-highlighted)">
        Holyer AI
      </h1>
    </div>

    <div class="flex items-center gap-2">
      <!-- 暗黑模式切换 -->
      <UButton
        :icon="isDark ? 'i-lucide-sun' : 'i-lucide-moon'"
        variant="ghost"
        size="sm"
        color="neutral"
        :aria-label="isDark ? '切换亮色模式' : '切换暗色模式'"
        @click="toggleMode"
      />
    </div>
  </header>
</template>

<style scoped lang='less'>

</style>
