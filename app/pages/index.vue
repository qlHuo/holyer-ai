<script lang='ts' setup>
import ChatPanel from '~/components/chat/ChatPanel.vue'
import LayoutHeader from '~/components/layout/LayoutHeader.vue'
import LayoutSidebar from '~/components/layout/LayoutSidebar.vue'

// 移动端侧边栏
const sidebarOpen = ref(false)

// 是否移动端
const isMobile = ref(false)

function checkMobile() {
  isMobile.value = window.innerWidth < 768
}

onMounted(() => {
  checkMobile()
  window.addEventListener('resize', checkMobile)
})

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
})
</script>

<template>
  <div class="h-screen flex flex-col overflow-hidden bg-(--ui-bg)">
    <!-- 顶部栏 -->
    <LayoutHeader
      :show-menu-button="isMobile"
      @toggle-sidebar="sidebarOpen = !sidebarOpen"
    />

    <!-- 主体区域 -->
    <div class="flex flex-1 overflow-hidden">
      <!-- ===== 桌面端侧边栏 ===== -->
      <aside
        v-if="!isMobile"
        class="w-72 shrink-0 border-r border-(--ui-border)"
      >
        <LayoutSidebar />
      </aside>
      <!-- ===== 移动端侧边栏（Slideover） ===== -->
      <USlideover
        v-if="isMobile"
        v-model:open="sidebarOpen"
        title="对话列表"
        side="left"
        class="w-72"
      >
        <template #content>
          <LayoutSidebar
            @close="sidebarOpen = false"
          />
        </template>
      </USlideover>

      <!-- ===== 聊天主区域 ===== -->
      <main class="flex-1 flex flex-col min-w-0">
        <ChatPanel />
      </main>
    </div>
  </div>
</template>

<!-- 禁用预渲染（需要客户端交互） -->
<style scoped>
/* 确保全屏高度 */
html,
body,
#__nuxt {
  height: 100%;
}
</style>
