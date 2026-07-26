<script lang='ts' setup>
const { switchConversation } = useChat()
const { isDark, toggleMode } = useTheme()
const chatStore = useChatStore()
const promptStore = usePromptStore()
const toast = useToast()
const route = useRoute()

// 移动端 Slideover 开关
const sidebarOpen = ref(false)

// 桌面端侧边栏折叠偏好
const sidebarCollapsed = useCookie('sidebar-collapsed', {
  default: () => false,
  watch: true
})

// 移动端检测
const isMobile = useMediaQuery('(max-width: 767px)')

// 是否在聊天页
const isChatPage = computed(() => route.path === '/')

// 工具栏搜索入口
const showToolbarSearch = computed(() => isMobile.value || sidebarCollapsed.value)

// 新建对话
async function handleCreateChat() {
  try {
    const emptyConv = chatStore.conversations.find(conv => conv.messageCount === 0)
    if (emptyConv) {
      await switchConversation(emptyConv.id)
      navigateTo('/')
      return
    }
    await chatStore.createConversation()
    navigateTo('/')
  } catch (error: any) {
    toast.add({ title: error || '新建对话失败', color: 'error', icon: 'i-lucide-alert-circle' })
  }
}

onMounted(() => {
  // 获取所有提示词
  promptStore.getList()
})
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

    <!-- ===== 主内容区 ===== -->
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
              @click="() => { sidebarCollapsed = !sidebarCollapsed }"
            />
            <UButton
              v-if="sidebarCollapsed && isChatPage"
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
              @click="() => { sidebarOpen = true }"
            />
            <UButton
              v-if="isChatPage"
              icon="bx:message-add"
              variant="ghost"
              size="sm"
              color="neutral"
              title="新建对话"
              @click="handleCreateChat"
            />
          </div>
        </div>

        <!-- 右侧：搜索 + 暗黑模式切换 -->
        <div class="flex items-center gap-1">
          <SearchModal
            v-if="showToolbarSearch"
            size="sm"
            title="搜索消息 (Ctrl+K)"
          />
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
      </div>

      <!-- 页面内容 -->
      <slot />
    </main>
  </div>
</template>

<style>
html,
body,
#__nuxt {
  height: 100%;
}
</style>
