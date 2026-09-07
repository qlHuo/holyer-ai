/**
 * 知识库首字母身份块 — 固定 6 色调色板，按创建时间确定性取色
 *
 * - 色板固定 6 组，亮暗双模适配；全部来自 Tailwind 默认 palette
 * - kbAvatarClasses(createdAt)：同一库跨刷新稳定（createdAt 不变），与排序无关
 * - kbInitial(name)：取首字（中文）或首字母（英文）
 *
 * 使用处：RagKbCard（卡片身份块）、/rag/:id 页头
 */
export const KB_AVATAR_PALETTE = [
  'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
] as const

/** 由创建时间哈希出稳定下标（0..5） */
export function kbAvatarIndex(createdAt: string): number {
  let h = 0
  for (let i = 0; i < createdAt.length; i++) {
    h = (h * 31 + createdAt.charCodeAt(i)) >>> 0
  }
  return h % KB_AVATAR_PALETTE.length
}

/** 按创建时间取整组 class（同库跨渲染稳定） */
export function kbAvatarClasses(createdAt: string): string {
  return KB_AVATAR_PALETTE[kbAvatarIndex(createdAt)]!
}

/** 名称首字/首字母（英文大写；中文取第一个字符） */
export function kbInitial(name: string): string {
  const s = name.trim()
  if (!s) return '?'
  const ch = s.charAt(0)
  return ch.toLowerCase() !== ch.toUpperCase() ? ch.toUpperCase() : ch
}
