import type { ExecutableTool, ToolPermission } from '../types'
import type { ToolDefinition } from '~~/shared/types/provider'

/**
 * 安全数学表达式计算工具
 * 不使用 eval()，而是通过 Function 构造器在受限作用域中执行四则运算，
 * 仅允许数字、运算符、括号、小数点和空白字符。
 */
const SAFE_EXPR_RE = /^[\d\s+\-*/().%eE]+$/

function safeEvaluate(expression: string): number {
  const trimmed = expression.trim()
  if (!trimmed) throw new Error('表达式不能为空')
  if (!SAFE_EXPR_RE.test(trimmed)) {
    throw new Error(`表达式包含不允许的字符，仅支持数字和 + - * / ( ) . % 运算符`)
  }
  // Function 构造器在严格模式下执行，无法访问闭包变量，相对安全
  const result = new Function(`"use strict"; return (${trimmed})`)()
  if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new Error(`计算结果无效: ${result}`)
  }
  return result
}

export class CalculatorTool implements ExecutableTool {
  readonly name = 'calculator'
  readonly description = '执行数学计算。支持 + - * / ( ) % 运算符、小数和科学计数法（如 1e10）。输入一个数学表达式字符串，返回计算结果。'
  readonly permission: ToolPermission = 'readonly'
  readonly parameters: Record<string, any> = {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: '要计算的数学表达式，例如 "2 + 3 * 4" 或 "(100 - 20) / 4"'
      }
    },
    required: ['expression']
  }

  execute(args: Record<string, unknown>): string {
    const expression = String(args.expression ?? '')
    try {
      const result = safeEvaluate(expression)
      return String(result)
    } catch (error) {
      return `计算错误: ${error instanceof Error ? error.message : '未知错误'}`
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
export const calculatorTool = new CalculatorTool()
