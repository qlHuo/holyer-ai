import { toolRegistry } from './registry'
import { calculatorTool } from './builtin/calculator'
import { webSearchTool } from './builtin/web-search'
import { webFetchTool } from './builtin/web-fetch'

// 模块首次 import 时自动注册（TypeScript 模块是单例的）
toolRegistry.register(calculatorTool)
toolRegistry.register(webSearchTool)
toolRegistry.register(webFetchTool)

// 导出本地绑定（非 re-export），确保 runner 拿到已注册的实例
export { toolRegistry }
export * from './builtin/calculator'
export * from './builtin/web-search'
export * from './builtin/web-fetch'
