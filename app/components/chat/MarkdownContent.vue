<script setup lang="ts">
import { getMarkdownParser, preprocessMarkdown } from '~/utils/markdown'

const props = defineProps({
  /** 原始 Markdown 文本 */
  content: {
    type: String,
    required: true
  },
  /** 是否正在流式输出中 — 流式期间跳过 mermaid 渲染，避免 SVG 反复重建 */
  isStreaming: {
    type: Boolean,
    default: false
  }
})

const colorMode = useColorMode()
const toast = useToast()

/** markdown-it 渲染后的 HTML */
const renderedHtml = computed(() => {
  const md = getMarkdownParser()
  const processed = preprocessMarkdown(props.content)
  return md.render(processed)
})

/** 容器 DOM 引用（用于 mermaid 查询作用域） */
const containerRef = ref<HTMLElement | null>(null)

/** mermaid 是否已完成首次初始化（全局单次） */
let mermaidReady = false

/** 是否已经有渲染任务在进行中（避免并发重复渲染） */
let rendering = false

// ---------------------------------------------------------------------------
// Mermaid 渲染
// ---------------------------------------------------------------------------

/**
 * 自动修复 mermaid 代码中常见的语法问题。
 *
 * 当前修复：
 * - 未引用的 [...] 标签中包含 ()/<> 等特殊字符时，自动加双引号
 *   例：B[setup() <br/> 入口] → B["setup() <br/> 入口"]
 */
function sanitizeMermaidCode(code: string): string {
  return code.replace(/\[([^\]"]+?)\]/g, (_match, content) => {
    if (/[()<>]/.test(content)) {
      return `["${content}"]`
    }
    return _match
  })
}

/**
 * 扫描容器内所有未处理的 .mermaid 元素，调用 mermaid.render() 逐个渲染为 SVG。
 *
 * 设计要点：
 * - onMounted 处理 SSR hydration 后的初始渲染（历史消息、页面刷新）
 * - watch 处理流式完成、内容编辑等动态场景
 * - rendering 锁防止并发调用（如 onMounted 和 watch 同时触发）
 */
async function renderMermaidDiagrams(): Promise<void> {
  if (rendering) return
  rendering = true

  try {
    await nextTick()
    const el = containerRef.value
    if (!el) return

    const mermaidEls = el.querySelectorAll<HTMLElement>('.mermaid:not([data-processed])')
    if (mermaidEls.length === 0) return

    const { default: mermaid } = await import('mermaid')

    if (!mermaidReady) {
      mermaid.initialize({
        startOnLoad: false,
        theme: colorMode.value === 'dark' ? 'dark' : 'default',
        securityLevel: 'strict'
      })
      mermaidReady = true
    }

    for (const mermaidEl of mermaidEls) {
      try {
        // textContent 自动解码 HTML 实体（escapeHtml 的逆操作）
        const code = (mermaidEl.textContent ?? '').trim()
        if (!code) continue
        const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`

        // 先尝试原始代码，失败则自动修复后重试
        let svg: string
        try {
          ;({ svg } = await mermaid.render(id, code))
        } catch {
          const sanitized = sanitizeMermaidCode(code)
          ;({ svg } = await mermaid.render(id, sanitized))
        }

        mermaidEl.innerHTML = svg
        mermaidEl.setAttribute('data-processed', 'true')
      } catch (err) {
        console.error('[mermaid] 图表渲染失败:', err)
        // 保留原始代码显示，不设置 data-processed
      }
    }
  } catch (err) {
    console.error('[mermaid] 模块加载失败:', err)
  } finally {
    rendering = false
  }
}

// ===========================================================================
// 双触发器覆盖所有场景
// ===========================================================================

/**
 * 触发器 1：onMounted
 *
 * 覆盖场景：页面刷新、SSR hydration 后、历史对话切换等初始加载。
 * onMounted 在 SSR hydration 完成后必定触发，不受 watch 时序影响。
 */
onMounted(() => {
  // 流式进行中的消息跳过 —— 交给触发器 2 在流结束时处理
  if (props.isStreaming) return
  renderMermaidDiagrams()
})

/**
 * 触发器 2：watch
 *
 * 覆盖场景：
 * - 流式输出结束（isStreaming: true → false）
 * - 消息内容被替换（如重新生成）
 */
watch([renderedHtml, () => props.isStreaming], async ([, streaming]) => {
  if (streaming) return
  // flush: 'post' 确保 DOM 已更新
  await renderMermaidDiagrams()
}, { flush: 'post' })

// ---------------------------------------------------------------------------
// 代码块复制
// ---------------------------------------------------------------------------

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
      color: 'primary',
      icon: 'i-lucide-check'
    })
  }).catch(() => {
    toast.add({
      title: '复制失败',
      color: 'error'
    })
  })
}
</script>

<template>
  <div
    ref="containerRef"
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
