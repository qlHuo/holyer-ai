import type { ExecutableTool, ToolPermission } from '../types'
import type { ToolDefinition } from '~~/shared/types/provider'

export class CurrentTimeTool implements ExecutableTool {
  readonly name = 'current_time'
  readonly description = '获取当前日期和时间。可指定时区（如 Asia/Shanghai、America/New_York），不指定则返回本地时间。'
  readonly permission: ToolPermission = 'readonly'
  // 参数定义格式
  readonly parameters: Record<string, any> = {
    // 告诉 LLM：参数是个对象
    type: 'object',
    // 告诉 LLM: 对象里有以下这些字段
    properties: {
      timezone: {
        // 告诉 LLM：这个字段必须是字符串
        type: 'string',
        // 告诉 LLM：这个字段的含义
        description: 'IANA 时区标识符，例如 "Asia/Shanghai"、"America/New_York"、"Europe/London"。不传则使用系统本地时区。'
      }
    },
    required: ['timezone']
  }

  execute(args: Record<string, unknown>): string {
    console.log('args.timezone', args.timezone)
    const timezone = typeof args.timezone === 'string' ? args.timezone : undefined
    const now = new Date()

    try {
      const formatter = new Intl.DateTimeFormat('zh-CN', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'long',
        timeZoneName: 'short'
      })
      return formatter.format(now)
    } catch {
      // 时区无效时回退到本地时间
      return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'long',
        timeZoneName: 'short'
      }).format(now)
    }
  }

  toDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters
    }
  }
}

export const currentTimeTool = new CurrentTimeTool()
