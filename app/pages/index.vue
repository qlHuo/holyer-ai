<script lang='ts' setup>
const { switchConversation } = useChat()
const { isDark, toggleMode } = useTheme()
const chatStore = useChatStore()
const toast = useToast()

// 移动端 Slideover 开关
const sidebarOpen = ref(false)

// 桌面端侧边栏折叠偏好
// useCookie 在 setup() 阶段同步读取 cookie，消除 SSR/预渲染闪烁
const sidebarCollapsed = useCookie('sidebar-collapsed', {
  default: () => false,
  watch: true
})

/** 新建对话（顶部工具栏调用） */
async function handleCreateChat() {
  try {
    const emptyConv = chatStore.conversations.find(conv => conv.messageCount === 0)
    if (emptyConv) {
      await switchConversation(emptyConv.id)
      return
    }
    await chatStore.createConversation()
  } catch (error: any) {
    toast.add({ title: error || '新建对话失败', color: 'error', icon: 'i-lucide-alert-circle' })
  }
}
</script>

<template>
  <div class="h-screen flex overflow-hidden bg-(--ui-bg)">
    <!-- ===== 桌面端侧边栏 ===== -->
    <aside
      class="hidden md:block shrink-0 overflow-hidden transition-all duration-200 ease-out"
      :class="sidebarCollapsed ? 'w-0 border-r-0' : 'w-72 border-r border-(--ui-border)'"
    >
      <LayoutSidebar />
    </aside>

    <!-- ===== 移动端侧边栏 ===== -->
    <USlideover
      v-model:open="sidebarOpen"
      title="Holyer AI"
      side="left"
      class="w-72 md:hidden"
    >
      <template #content>
        <LayoutSidebar @close="sidebarOpen = false" />
      </template>
    </USlideover>

    <!-- ===== 聊天主区域 ===== -->
    <main class="flex-1 flex flex-col min-w-0">
      <!-- 顶部工具栏 -->
      <div
        class="h-12 px-3 border-b border-(--ui-border) flex items-center justify-between shrink-0"
      >
        <!-- 左侧工具栏按钮 -->
        <div class="flex items-center gap-1">
          <!-- 桌面端 -->
          <div class="hidden md:flex">
            <UButton
              icon="cuida:sidebar-collapse-outline"
              variant="ghost"
              size="sm"
              color="neutral"
              :title="sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'"
              @click="sidebarCollapsed = !sidebarCollapsed"
            />
            <UButton
              v-if="sidebarCollapsed"
              icon="bx:message-add"
              variant="ghost"
              size="sm"
              color="neutral"
              title="新建对话"
              @click="handleCreateChat"
            />
          </div>
          <!-- 移动端 -->
          <div class="block md:hidden">
            <UButton
              icon="cuida:sidebar-collapse-outline"
              variant="ghost"
              size="sm"
              color="neutral"
              title="菜单"
              @click="sidebarOpen = true"
            />
            <UButton
              icon="bx:message-add"
              variant="ghost"
              size="sm"
              color="neutral"
              title="新建对话"
              @click="handleCreateChat"
            />
          </div>
        </div>

        <!-- 右侧：暗黑模式切换 -->
        <UButton
          :icon="isDark ? 'i-lucide-sun' : 'i-lucide-moon'"
          variant="ghost"
          size="sm"
          color="neutral"
          :aria-label="isDark ? '切换亮色模式' : '切换暗色模式'"
          :title="isDark ? '切换亮色模式' : '切换暗色模式'"
          @click="toggleMode"
        />
      </div>

      <ChatPanel class="flex-1 min-h-0" />
    </main>
  </div>
</template>

<style scoped>
html,
body,
#__nuxt {
  height: 100%;
}
</style>
