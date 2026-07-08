---
paths:
  - "server/api/**"
  - "server/service/**"
  - "shared/types/response.ts"
description: API 路由与 Service 层规范 — zod 验证、响应格式、Service 分层、SSE 端点模式
---

# API 路由与 Service 层规范

## 何时应用此规则

- 新增或修改 `server/api/` 下的任何 API 路由
- 新增或修改 `server/service/` 下的业务逻辑函数
- 定义新的请求/响应类型时
- 出现"API 返回了非标准格式的响应"问题时
- 在路由中直接写 `db.select()` 或 `db.insert()` 时

## 分层架构

```
API 路由（server/api/）         → 参数验证 + 调用 Service + 响应包装
    │
Service 层（server/service/）   → 业务逻辑 + 数据库查询 + 类型转换
    │
Drizzle ORM（server/db/）       → Schema 定义 + 数据库实例
```

**硬约束**：API 路由不得直接 `import { db } from '~~/server/db'`。

```ts
// ❌ 错误：API 路由中直接写数据库查询
export default defineEventHandler(async () => {
  const rows = await db.select().from(conversations)
  return rows
})

// ✅ 正确：路由调用 Service，Service 做查询
export default defineEventHandler(async () => {
  const data = await getConversationList()  // Service 函数
  return successResponse(data)
})
```

## Zod 参数验证

每个 API 端点的请求体必须有对应的 Zod Schema 文件（`schema.ts`），不内联在路由中：

```ts
// schema.ts — 集中管理验证逻辑
export const CreateConversationSchema = z.object({
  title: z.string().max(100).optional(),
  model: z.string().min(1, 'model 是必填项'),
  provider: z.enum(['openai', 'anthropic', 'deepseek'])
})

// 路由中 — 第一行就校验
const body = CreateConversationSchema.parse(await readBody(event))
```

**原因**：Schema 文件和路由文件分离，便于类型推导（`z.infer<>`）和复用（如 PUT 端点复用 GET 的 Schema 子集）。

## 响应格式

所有 REST 端点统一使用 `successResponse` / `errorResponse` 包装：

```ts
import { successResponse } from '~~/server/utils/response'

// 成功响应
return successResponse(data) // → { success: true, data: {...} }

// 错误响应：用 createError，不走 errorResponse（Nitro 自动处理）
throw createError({ statusCode: 404, message: '会话不存在' })
```

**区分**：
- `throw createError()` — 客户端问题（404、400）、鉴权失败（401）
- `errorResponse()` — 内部已知错误、业务异常需要自定义 code 时

## SSE 端点模式

SSE 端点（如 `/api/chat`、`/api/agent/run`）遵循统一模式：

```
1. Zod 验证请求体
2. getOrCreateConversation 获取对话上下文
3. 构建 ReadableStream<SSEChunk>（业务逻辑：LLM 调用、Agent 循环）
4. 交给 createSSEResponse() 包装成标准 SSE Response
```

**不在 SSE 端点内**手动设置 `Content-Type: text/event-stream` 等响应头——统一由 `createSSEResponse()` 处理。

## Service 函数规范

- 函数名使用动词开头：`get*`、`create*`、`update*`、`delete*`
- 返回类型是 API 契约类型（如 `ConversationDetail`），不是 Drizzle 原始行类型
- 类型转换在 Service 层完成（`row.createdAt.toISOString()`），API 路由拿到的是干净的 JSON 类型

## 相关文档

- [conversation-persistence-design](../../docs/dev-log/2026-06-03-conversation-persistence-design.md) — Service 层缺失与修复方案
- [code-review-conversation](../../docs/dev-log/2026-06-05-code-review-conversation.md) — API 路由代码审查，N+1 查询警示
