/**
 * AgentMemory — Agent 运行时消息管理
 *
 * 职责：
 * 1. 存储 ReAct 循环中的消息数组
 * 2. 超过阈值时自动裁剪（保留 system + 最近 N 条非 system 消息）
 * 3. 裁剪时不拆散 tool call 和 tool result 的配对
 */

import type { Message } from '~~/shared/types/provider'

/** 默认保留最近的非 system 消息条数 */
const DEFAULT_MAX_HISTORY = 40

export class AgentMemory {
  private systemMessages: Message[]
  private historyMessages: Message[]
  private maxHistory: number

  constructor(messages: Message[], maxHistory: number = DEFAULT_MAX_HISTORY) {
    // 分离 system 消息和其他消息——system 消息永不被裁剪
    this.systemMessages = messages.filter(m => m.role === 'system')
    this.historyMessages = messages.filter(m => m.role !== 'system')
    this.maxHistory = maxHistory
  }

  /** 添加一条消息，自动触发裁剪检查 */
  add(msg: Message): void {
    this.historyMessages.push(msg)
    this.trim()
  }

  /** 获取完整消息数组（system + 裁剪后的历史） */
  getAll(): Message[] {
    return [...this.systemMessages, ...this.historyMessages]
  }

  /** 裁剪历史消息，保留最近 maxHistory 条，同时保证不拆散 tool call 配对 */
  private trim(): void {
    if (this.historyMessages.length <= this.maxHistory) return

    const toRemove = this.historyMessages.length - this.maxHistory
    let cutIndex = toRemove

    // 如果裁剪边界的第一条是 tool role，说明它对应的 assistant(tool_calls) 被裁掉了，
    // 往前推直到第一条不是 tool role，保证 tool call 和 result 不分离
    while (cutIndex < this.historyMessages.length && this.historyMessages[cutIndex]?.role === 'tool') {
      cutIndex++
    }

    this.historyMessages = this.historyMessages.slice(cutIndex)
  }

  /** 估算当前消息的 token 数（简化版：中文字符/1.5 + 其他/4） */
  estimateTokens(): number {
    let total = 0
    for (const msg of this.getAll()) {
      const text = msg.content || ''
      const chineseChars = (text.match(/[一-鿿]/g) || []).length
      const otherChars = text.length - chineseChars
      total += Math.ceil(chineseChars / 1.5 + otherChars / 4)
    }
    return total
  }

  /**
   * 获取所有 tool 角色消息的可变引用
   *
   * 返回的是 historyMessages 中实际 Message 对象的引用（非副本），
   * 调用方直接修改返回对象的 content 字段即可更新 memory 中的数据。
   *
   * 使用场景：LLM 内容审核拦截后，逐条试毒找出有问题的搜索结果并替换为占位文本。
   */
  getToolMessages(): Message[] {
    return this.historyMessages.filter(m => m.role === 'tool')
  }

  /** 清空历史（仅保留 system 消息） */
  clear(): void {
    this.historyMessages = []
  }
}
