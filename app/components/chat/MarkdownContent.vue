<script setup lang="ts">
import { getMarkdownParser, preprocessMarkdown } from '~/utils/markdown'

const props = defineProps({
  /** 原始 Markdown 文本 */
  content: {
    type: String,
    required: true
  }
})

const toast = useToast()

/** 渲染后的 HTML */
const renderedHtml = computed(() => {
  const md = getMarkdownParser()
  const processed = preprocessMarkdown(props.content)
  return md.render(processed)
})

/** 点击委托：处理代码块复制按钮 */
function handleClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const btn = target.closest('.code-copy-btn') as HTMLElement | null
  if (!btn) return

  const rawCode = btn.getAttribute('data-code')
  if (!rawCode) return

  // 解码 HTML 实体
  const textarea = document.createElement('textarea')
  textarea.innerHTML = rawCode
  const decoded = textarea.value

  navigator.clipboard.writeText(decoded).then(() => {
    toast.add({
      title: '已复制到剪贴板',
      color: 'success',
      icon: 'i-lucide-check',
      duration: 2000
    })
  }).catch(() => {
    toast.add({
      title: '复制失败',
      color: 'error',
      duration: 2000
    })
  })
}
</script>

<template>
  <div
    class="markdown-body"
    @click="handleClick"
  >
    <!--
      v-html 在此处是安全的：
      markdown-it 配置了 html: false，所有 HTML 标签都被转义
    -->
    <div v-html="renderedHtml" />
  </div>
</template>
