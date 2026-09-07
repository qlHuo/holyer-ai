/**
 * 知识库首字母身份块 — 固定 6 色调色板，按创建时间确定性取色
 *
 * - 色板固定 6 组，亮暗双模适配；全部来自 Tailwind 默认 palette
 * - **色相策略：冷色相邻带**（analogous cool）——cyan/sky/blue/indigo/violet/teal
 *   均在色轮上与品牌 sky 主色相邻，六色互搭、不跳色；**不用暖色**（rose/amber 曾让
 *   同一网格里色相互相打架）
 * - 风格：扁平浅底 + 深字（**无渐变、无描边**的轻量色块）；暗黑 15% 透底 + 亮字
 * - kbAvatarClasses(createdAt)：同一库跨刷新稳定（createdAt 不变），与排序无关
 * - kbInitial(name)：取首字（中文）或首字母（英文）
 *
 * 使用处：RagKbCard（卡片身份块）、/rag/:id 页头
 */
export const KB_AVATAR_PALETTE = [
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300'
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
