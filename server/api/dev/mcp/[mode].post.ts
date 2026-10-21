/**
 * 开发环境 MCP 测试 Server（仅 import.meta.dev 可用）
 *
 *   POST /api/dev/mcp/modern  — 2026-07-28 无状态格式
 *   POST /api/dev/mcp/legacy  — 2025-06-18 initialize + session
 *   POST /api/dev/mcp/broken  — 返回 HTML，用于验证错误映射
 *
 * 用途：M1 阶段在没有公网 MCP Server 的情况下验证客户端的
 * 现代 / legacy / 坏响应三条路径。
 */

type Mode = 'modern' | 'legacy' | 'broken' | 'sse'

const TOOLS = [
  {
    name: 'echo',
    description: '原样返回输入文本',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要回显的文本' }
      },
      required: ['text']
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'get_weather',
    description: '查询指定城市的当前天气（开发测试数据）',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '城市名' }
      },
      required: ['city']
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'always_fail',
    description: '总是返回 isError（用于测试失败回填）',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    annotations: { readOnlyHint: true }
  }
]

interface RpcRequest {
  jsonrpc?: string
  id?: string | number
  method?: string
  params?: unknown
}

export default defineEventHandler(async (event) => {
  if (!import.meta.dev) {
    throw createError({ statusCode: 404, message: 'Not Found' })
  }

  const mode = getRouterParam(event, 'mode') as Mode | undefined

  if (mode === 'broken') {
    setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')
    return '<!doctype html><html><body><h1>Not an MCP server</h1></body></html>'
  }

  if (mode !== 'modern' && mode !== 'legacy' && mode !== 'sse') {
    throw createError({ statusCode: 404, message: 'Unknown dev MCP mode' })
  }

  if (mode === 'sse') {
    setResponseHeader(event, 'content-type', 'text/event-stream; charset=utf-8')
  }

  const message = await readBody<RpcRequest>(event)
  const params = isRecord(message.params) ? message.params : {}
  const args = isRecord(params.arguments) ? params.arguments : {}

  // legacy：除握手外必须带会话
  if (mode === 'legacy' && message.method !== 'initialize' && !getHeader(event, 'mcp-session-id')) {
    setResponseStatus(event, 400)
    return {
      jsonrpc: '2.0',
      id: message.id ?? null,
      error: { code: -32000, message: 'Missing Mcp-Session-Id' }
    }
  }

  // JSON-RPC 通知：202，无响应体
  if (message.id === undefined) {
    setResponseStatus(event, 202)
    return null
  }

  const respond = (payload: Record<string, unknown>) => mode === 'sse'
    ? `data: ${JSON.stringify(payload)}\n\n`
    : payload

  const ok = (value: Record<string, unknown>) => respond({
    jsonrpc: '2.0',
    id: message.id,
    result: mode === 'legacy' ? value : { resultType: 'complete', ...value }
  })

  const fail = (code: number, text: string) => respond({
    jsonrpc: '2.0',
    id: message.id,
    error: { code, message: text }
  })

  switch (message.method) {
    case 'initialize':
      if (mode !== 'legacy') return fail(-32601, 'Method not found: initialize')
      setResponseHeader(event, 'mcp-session-id', 'dev-session-1')
      return ok({
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'dev-mcp-legacy', version: '0.0.1' }
      })

    case 'server/discover':
      if (mode === 'legacy') return fail(-32601, 'Method not found: server/discover')
      return ok({
        supportedVersions: ['2026-07-28'],
        capabilities: { tools: { listChanged: false } },
        instructions: 'development fixture',
        ttlMs: 0,
        cacheScope: 'private',
        _meta: {
          'io.modelcontextprotocol/serverInfo': { name: 'dev-mcp', version: '0.0.1' }
        }
      })

    case 'tools/list':
      return ok({ tools: TOOLS, ttlMs: 0, cacheScope: 'private' })

    case 'tools/call': {
      const name = params.name

      if (name === 'echo') {
        return ok({
          content: [{ type: 'text', text: String(args.text ?? '') }]
        })
      }
      if (name === 'get_weather') {
        return ok({
          content: [{ type: 'text', text: `${String(args.city ?? '未知城市')}：24°C，多云（开发测试数据）` }]
        })
      }
      if (name === 'always_fail') {
        return ok({
          content: [{ type: 'text', text: '模拟工具执行失败' }],
          isError: true
        })
      }
      return fail(-32602, `Unknown tool: ${String(name)}`)
    }

    default:
      return fail(-32601, `Method not found: ${String(message.method)}`)
  }
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
