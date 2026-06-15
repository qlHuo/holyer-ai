/**
 * @Description 暗黑模式 composable
 *
 * 封装 NuxtUI V4 的 useColorMode() 提供语义化的 isDark 和 toggle
 * colorMode.perference 修改后会自动持久化到 localStorage
 * 也会自动在 html 上添加或者移除class，驱动tailwind dark:
 */

export function useTheme() {
  const colorMode = useColorMode()

  const isDark = computed(() => colorMode.value === 'dark')

  function toggleMode() {
    // colorMode.preference 赋值即触发切换 + 持久化
    colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
  }

  return {
    // 原始 ref: light | dark | system
    colorMode,
    isDark,
    toggleMode
  }
}
