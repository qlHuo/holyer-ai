import type { ExecutableTool } from './types'

export class ToolRegistry {
  private tools = new Map<string, ExecutableTool>()

  // 注册工具
  register(tool: ExecutableTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`工具 ${tool.name} 已经注册`)
    }
    this.tools.set(tool.name, tool)
  }

  // 获取工具
  get(name: string): ExecutableTool | undefined {
    return this.tools.get(name)
  }

  // 获取所有工具定义
  getDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map(t => t.toDefinition())
  }

  // 获取所有工具
  list(): ExecutableTool[] {
    return [...this.tools.values()]
  }
}

export const toolRegistry = new ToolRegistry()
