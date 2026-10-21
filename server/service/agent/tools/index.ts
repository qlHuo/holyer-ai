import { ToolRegistry } from './registry'
import type { ExecutableTool } from './types'
import { calculatorTool } from './builtin/calculator'
import { webSearchTool } from './builtin/web-search'
import { webFetchTool } from './builtin/web-fetch'
import { knowledgeBaseSearchTool } from './builtin/knowledge-base-search'

/** 内置工具清单；顺序固定，避免工具定义顺序变化导致 prompt cache 失效 */
export const builtinTools: ExecutableTool[] = [
  calculatorTool,
  webSearchTool,
  webFetchTool,
  knowledgeBaseSearchTool
]

/**
 * 构建请求级工具注册表。
 *
 * MCP 工具按用户配置动态加入，不能写进模块级单例——Workers isolate
 * 被并发请求共享，全局可变注册表会造成跨请求/跨用户泄漏。
 */
export function createToolRegistry(extra: ExecutableTool[] = []): ToolRegistry {
  const registry = new ToolRegistry()

  for (const tool of [...builtinTools, ...extra]) {
    registry.register(tool)
  }
  return registry
}

export { ToolRegistry }
export * from './builtin/calculator'
export * from './builtin/web-search'
export * from './builtin/web-fetch'
export * from './builtin/knowledge-base-search'
