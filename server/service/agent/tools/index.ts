import { toolRegistry } from './registry'
import { calculatorTool } from './builtin/calculator'
import { currentTimeTool } from './builtin/current-time'

// 模块首次 import 时自动注册
toolRegistry.register(calculatorTool)
toolRegistry.register(currentTimeTool)

// 导出本地绑定（非 re-export），确保 runner 拿到已注册的实例
export { toolRegistry }
export * from './builtin/calculator'
export * from './builtin/current-time'
