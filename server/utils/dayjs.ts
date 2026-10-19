/**
 * dayjs 统一入口
 *
 * 为什么需要这层封装：
 * dayjs 插件通过 `dayjs.extend()` 注册，属于全局副作用——只需注册一次，
 * 但必须在任何用到插件能力（如 `.tz()`）的代码之前完成。
 * 如果各模块直接 `import dayjs from 'dayjs'`，很容易遗漏插件注册，
 * 且失败发生在运行时而非类型检查阶段。
 *
 * 规则：业务代码只从这里导入 dayjs，不要直接 import 'dayjs'。
 */

import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

export default dayjs
