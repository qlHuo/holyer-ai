/**
 * 当前时间 — 系统提示词片段
 *
 * 为什么放在 service 而不是 utils：
 * 这里包含业务语义（北京时间、提示词措辞），不属于通用工具。
 * 通用时间能力交给 dayjs（见 CLAUDE.md「通用能力优先用成熟库」）。
 *
 * 时区说明：Cloudflare Workers 运行时的 Date 时区是 UTC，
 * 不能用 getHours()/getDay()；dayjs.tz 基于 Intl 实现，跨运行时一致。
 */

import dayjs from '../../utils/dayjs'

const BEIJING_TZ = 'Asia/Shanghai'
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const

/** 生成「当前时间」提示词段落 */
export function buildDateContext(now: Date = new Date()): string {
  const t = dayjs(now).tz(BEIJING_TZ)

  return `## 当前时间
今天是 ${t.year()} 年 ${t.month() + 1} 月 ${t.date()} 日（周${WEEKDAYS[t.day()]}），当前时间是 ${t.format('HH:mm')}（北京时间 UTC+8）。
搜索实时信息时，请使用上述日期作为参考，不要使用过期的年份。`
}
