# Zod 知识笔记

> Zod 是 TypeScript 优先的运行时校验库。本文以项目实际代码为例，记录 Schema 定义、校验方式、错误处理和文件组织模式。

---

## 核心理念

Zod 让你**定义一次 Schema，同时获得运行时校验 + TypeScript 类型**：

```typescript
import { z } from 'zod'

const Schema = z.object({
  name: z.string().min(1),
  age: z.number().int().positive()
})

// 运行时校验
const data = Schema.parse(input)  // 不合法会 throw ZodError

// 静态类型推导（无需手写 interface）
type Data = z.infer<typeof Schema>
// → { name: string; age: number }
```

---

## 常用类型一览

项目中使用过的所有 Zod 类型，按出现频率排列：

### 基础类型

| Zod 写法 | 对应 TS 类型 | 项目实例 |
|---------|------------|---------|
| `z.string()` | `string` | 名称、描述、消息内容 |
| `z.number()` | `number` | temperature、maxTokens |
| `z.boolean()` | `boolean` | regenerate（是否重新生成） |
| `z.enum(['a', 'b'])` | `'a' \| 'b'` | provider、role |
| `z.record(z.string(), z.unknown())` | `Record<string, unknown>` | tool parameters（动态键值对） |

### 复合类型

| Zod 写法 | 对应 TS 类型 | 项目实例 |
|---------|------------|---------|
| `z.object({...})` | `{ ... }` | 所有请求体 |
| `z.array(z.object({...}))` | `Array<{...}>` | messages 数组 |
| `z.array(z.string())` | `string[]` | 简单字符串数组 |

### 字符串专用方法

| 方法 | 作用 | 项目实例 |
|------|------|---------|
| `.min(1)` | 最小长度 | `z.string().min(1, '不能为空')` |
| `.max(100)` | 最大长度 | `z.string().max(100, '不能超过100字符')` |
| `.uuid()` | UUID 格式校验 | `z.string().uuid()` 校验路由参数 id |

### 数字专用方法

| 方法 | 作用 | 项目实例 |
|------|------|---------|
| `.int()` | 必须整数 | `maxTokens` |
| `.positive()` | 必须 > 0 | `maxTokens` |
| `.min(0)` | 最小值 | `temperature` 最低 0 |
| `.max(2)` | 最大值 | `temperature` 最高 2 |

### 可选性控制

| 方法 | 含义 | 适用场景 |
|------|------|---------|
| `.optional()` | 字段可缺失，值为 `T \| undefined` | 选填字段（如 `description`） |
| `.nullish()` | 字段可为 `null` 或 `undefined` | 显式传 null 表示"清空"（如 `conversationId`） |

**`optional()` vs `nullish()` 的区别**：

```typescript
// optional: 只能不传，不能传 null
z.string().optional()        // string | undefined

// nullish: 可以不传，也可以传 null
z.string().nullish()         // string | null | undefined
```

项目中 `conversationId` 使用 `.nullish()` 而非 `.optional()`，因为前端在"不关联对话"时可能显式传 `null`。

---

## Schema 定义模式

### 模式一：独立 schema.ts 文件（推荐）

项目中 prompts、conversations、chat 模块都采用此模式：

```typescript
// server/api/prompts/schema.ts
import { z } from 'zod'

export const createPromptSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100, '名称不能超过 100 个字符'),
  description: z.string().max(500, '描述最长500字符').optional(),
  prompt: z.string().min(1, '提示词内容不能为空')
})

// 从 Schema 推导类型
export type CreatePromptInput = z.infer<typeof createPromptSchema>
```

**为什么 Schema 和路由文件分开？**
- 类型推导（`z.infer<>`）可在多处复用
- 创建和更新的 Schema 可能有细微差异（如更新时某些字段可选）
- 路由文件保持简洁，只关注 HTTP 层面的逻辑

### 模式二：内联简易校验

当校验很简单（如只校验路由参数 id）时，直接内联：

```typescript
// server/api/conversations/[id].get.ts
const id = z.string().uuid().parse(getRouterParam(event, 'id'))
```

不需要单独的 schema 文件——一行就够。

### 模式三：嵌套 Schema 复用

复杂对象中的子结构抽成独立 Schema，组合使用：

```typescript
// server/api/chat/schema.ts
const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  toolCalls: z.array(z.object({
    id: z.string(),
    name: z.string(),
    arguments: z.string()
  })).optional(),
  toolCallId: z.string().optional()
})

export const ChatBodySchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'deepseek']),
  model: z.string().min(1, 'model 不能为空'),
  message: z.array(MessageSchema),  // ← 复用 MessageSchema
  // ...
})
```

---

## 两种校验方式

### .parse() — 抛异常（主流方式）

项目中绝大多数 API 路由使用此方式：

```typescript
// 校验失败直接 throw ZodError，由全局 error-handler 兜底
const body = createPromptSchema.parse(await readBody(event))
```

**适用场景**：请求体校验。校验失败 → 抛 `ZodError` → 全局插件统一返回 400 + 字段级详情。

### .safeParse() — 不抛异常

唯一使用场景是 `search.get.ts` 中的查询参数校验：

```typescript
// server/api/search.get.ts
const parsed = QuerySchema.safeParse(getQuery(event))
if (!parsed.success) {
  throw createError({
    statusCode: 400,
    statusMessage: parsed.error.issues[0]?.message ?? '参数校验失败'
  })
}
// 校验通过，使用 parsed.data
const results = await searchMessages(parsed.data.q)
```

**为什么 search 用 `.safeParse()`？**
- 查询参数校验失败不想走全局 `ZodError` 处理——想自定义错误消息格式
- `.safeParse()` 返回 `{ success: boolean, data?: T, error?: ZodError }`，可以手动控制错误响应

**选择指南**：

| 方式 | 失败行为 | 适用场景 |
|------|---------|---------|
| `.parse()` | throw `ZodError` | 请求体校验（99% 的情况），交给全局 error-handler |
| `.safeParse()` | 返回 `{ success: false }` | 需要自定义错误格式，或不想抛异常 |

---

## 校验上下文：三种数据来源

项目中对三种 HTTP 数据来源都有对应的校验方式：

| 数据来源 | 获取方式 | 校验方式 | 示例 |
|---------|---------|---------|------|
| 请求体 | `await readBody(event)` | Schema 文件 + `.parse()` | `createPromptSchema.parse(await readBody(event))` |
| 路由参数 | `getRouterParam(event, 'id')` | 内联或 Schema 文件 + `.parse()` | `z.string().uuid().parse(...)` |
| 查询参数 | `getQuery(event)` | `.safeParse()` | `QuerySchema.safeParse(getQuery(event))` |

**关键差异**：`getRouterParam` 和 `getQuery` 返回的都是 `string` 类型（URL 参数天然是字符串），所以校验时不需要处理数字/布尔转换。

---

## 全局错误处理

项目通过 Nitro 插件 `server/plugins/error-handler.ts` 统一拦截所有 `ZodError`：

```typescript
import { ZodError } from 'zod'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error, context) => {
    const unwrapped = isError(error) ? error.cause : error

    if (unwrapped instanceof ZodError) {
      setResponseStatus(event, 400)
      // 将 issues 转成字段级错误详情
      send(event, JSON.stringify(
        errorResponse('VALIDATION_ERROR', '请求参数校验失败',
          error.issues.map(e => ({
            path: e.path.join('.'),   // 字段路径，如 "message.0.role"
            message: e.message        // 自定义错误消息，如 "名称不能为空"
          }))
        )
      ))
    }
  })
})
```

**这个插件意味着**：API 路由中用 `.parse()` 校验失败后，不需要手动 try-catch——插件自动返回 400 + 字段级详情。

### ZodError 结构

```typescript
// ZodError.issues 的结构
[
  {
    code: 'too_small',
    minimum: 1,
    type: 'string',
    message: '名称不能为空',  // 来自 .min(1, '名称不能为空') 的自定义消息
    path: ['name'],           // 字段路径数组
  }
]
```

---

## 实际场景对照

### 场景一：创建资源（POST）

```typescript
// schema.ts
export const createPromptSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100),
  description: z.string().max(500).optional(),
  prompt: z.string().min(1, '提示词内容不能为空')
})

// 路由中
const body = createPromptSchema.parse(await readBody(event))
// body 类型由 z.infer 自动推导，无需手写 interface
```

### 场景二：更新资源（PUT）

当创建和更新的字段有差异时，定义两个 Schema：

```typescript
// prompts 的创建和更新字段相同，但语义上分开定义
export const updatePromptSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100),
  description: z.string().max(500).optional(),
  prompt: z.string().min(1, '提示词内容不能为空')
})
```

如果更新时某些字段可选（如 PATCH 语义），可以利用 `.optional()` 区分。

### 场景三：路由参数校验

```typescript
// id 校验抽成独立 Schema，GET/PUT/DELETE 复用
export const promptIdSchema = z.string().min(1, 'id 不能为空')

// 路由中
const id = promptIdSchema.parse(getRouterParam(event, 'id'))
```

### 场景四：查询参数校验

```typescript
// GET /api/search?q=搜索词
const QuerySchema = z.object({
  q: z.string().min(1, '搜索词不能为空').max(200, '搜索词过长')
})

const parsed = QuerySchema.safeParse(getQuery(event))
// 用 safeParse 而非 parse，手动控制错误响应格式
```

### 场景五：枚举值校验

```typescript
provider: z.enum(['openai', 'anthropic', 'deepseek'])
// 输入必须是这三个值之一，否则校验失败
// 类型推导为 'openai' | 'anthropic' | 'deepseek'
```

---

## 项目文件组织

```
server/api/
├── chat/
│   └── schema.ts          ← ChatBodySchema（最复杂，含嵌套 MessageSchema）
├── conversations/
│   └── schema.ts          ← CreateConversationSchema
├── prompts/
│   ├── schema.ts          ← createPromptSchema, updatePromptSchema, promptIdSchema
│   ├── index.get.ts       ← 无 body 校验（GET 无请求体）
│   ├── index.post.ts      ← createPromptSchema.parse(readBody)
│   ├── [id].get.ts        ← promptIdSchema.parse(getRouterParam)
│   ├── [id].put.ts        ← promptIdSchema + updatePromptSchema
│   └── [id].delete.ts     ← promptIdSchema.parse(getRouterParam)
└── search.get.ts          ← QuerySchema.safeParse(getQuery)（内联）
```

**约定**：
- Schema 文件与 API 路由放在同一目录，命名为 `schema.ts`
- 简单的路由参数校验（一行）可内联在路由文件中
- 查询参数的 Schema 可内联在路由文件中（项目中只有 search 一个查询端点）

---

## 常见问题

| 问题 | 答案 |
|------|------|
| 为什么不用 `z.object()` 的 `.strict()`？ | 本项目没用到。`.strict()` 会拒绝未知 key，默认行为是静默丢弃。前端可能多传字段（如临时调试参数），丢弃比报错更宽松 |
| `z.infer<>` 和手写 `interface` 哪个好？ | 项目统一用 `z.infer<>`。修改 Schema 时类型自动更新，不会出现 Schema 和类型不一致 |
| `createPromptSchema` 和 `updatePromptSchema` 字段完全一样，为什么要分开？ | 语义隔离。将来创建和更新的规则可能分化（如更新时某些字段可选），提前分开避免后续重构 |
| `.optional()` 字段不传时值是什么？ | `undefined`。Zod 校验通过后，该字段在结果对象中不存在 |
| 全局 error-handler 拦截了 ZodError，我还能手动 try-catch 吗？ | 可以。如果你在路由中 catch 了 ZodError 并自己处理，它就不会冒泡到全局插件 |

---

## 相关文档

- [API 路由与 Service 层规范](../../.claude/rules/api-conventions.md) — Zod 在 API 层的使用要求
- [drizzle-orm](drizzle-orm.md) — Drizzle ORM API 笔记
- [drizzle-kit](drizzle-kit.md) — Drizzle Kit CLI 工具笔记
