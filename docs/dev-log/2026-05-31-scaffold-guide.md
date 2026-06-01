# 2026-05-31 — 项目初始化完整指南

> 从零开始搭建 holyer-ai 项目的分步操作手册。

---

## 前置准备

### 环境要求

| 工具 | 最低版本 | 检查命令 |
|------|---------|---------|
| Node.js | ^22.x | `node -v` |
| pnpm（推荐）或 npm | pnpm ^9 | `pnpm -v` |
| Git | ^2.40 | `git --version` |

### 外部服务账号（提前注册好）

| 服务 | 用途 | 获取地址 |
|------|------|---------|
| Neon | PostgreSQL + pgvector | neon.tech → 创建项目 → 复制连接池化 URL |
| OpenAI | LLM Provider | platform.openai.com → API Keys |
| Anthropic | LLM Provider | console.anthropic.com → API Keys |
| DeepSeek | LLM Provider | platform.deepseek.com → API Keys |
| Cloudflare | 部署（Phase 1 后期） | dash.cloudflare.com |

> ⚠️ **关键**：Neon 连接字符串必须包含 `-pooler.` 段。这是 Edge Runtime 兼容的前提 — 只有 HTTP 连接池化 URL 才能在 Cloudflare Workers 中工作。

### Git 初始化

```bash
cd d:\workspace\holyer-ai
git init
echo "node_modules\n.env\n.output\n.nuxt\ndist\n*.log" > .gitignore
```

---

## Phase 0：项目脚手架（预计半天）

### 步骤 1：创建 Nuxt 4 项目

```bash
npx nuxi@latest init . --package-manager pnpm
```

交互选项：
- TypeScript：**Yes**
- Nuxt UI：**Yes**（自动安装 Nuxt UI v4）
- Git init：**No**（已手动 init）

### 步骤 2：安装数据库依赖

```bash
pnpm add drizzle-orm @neondatabase/serverless
pnpm add -D drizzle-kit
```

### 步骤 3：创建环境变量文件

`.env`（已在 `.gitignore` 中）：

```
DATABASE_URL=postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/db?sslmode=require
OPENAI_API_KEY=sk-xxx
ANTHROPIC_API_KEY=sk-ant-xxx
DEEPSEEK_API_KEY=sk-xxx
```

> 💡 **关于环境变量访问**：服务端代码（`server/` 目录下）不直接使用 `process.env`，而是通过 Nuxt 的 `useRuntimeConfig()`。`nuxt.config.ts` 的 `runtimeConfig` 负责把 `.env` 中的变量映射进来。`drizzle.config.ts` 是 CLI 工具，不在 Nitro 里运行，所以可以直接用 `process.env`。

### 步骤 4：配置 Nuxt

`nuxt.config.ts` — 核心配置 + 环境变量映射：

```ts
export default defineNuxtConfig({
  modules: ['@nuxt/ui'],
  devtools: { enabled: true },

  // 服务端环境变量（映射 .env → runtimeConfig）
  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL,
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    deepseekApiKey: process.env.DEEPSEEK_API_KEY,
  },

  nitro: {
    preset: 'cloudflare-pages',
  },
  ui: {
    colors: {
      primary: 'sky',
    }
  },
})
```

> ⚠️ `runtimeConfig` 中的 key 采用 camelCase，Nitro 会自动映射到大写下划线环境变量（如 `databaseUrl` ↔ `NUXT_DATABASE_URL`）。但如果像上面这样在 `nuxt.config.ts` 中手动赋值 `process.env.XXX`，则变量名不受前缀限制——可以用 `DATABASE_URL` 而非 `NUXT_DATABASE_URL`。服务端代码中通过 `useRuntimeConfig().databaseUrl` 获取值，避免 `process.env` 的类型问题。

### 步骤 5：配置 Drizzle ORM

`drizzle.config.ts`：

```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
```

### 步骤 5：配置 Drizzle ORM

`drizzle.config.ts`：

```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
```

### 步骤 6：创建目录结构骨架

```bash
# 前端
mkdir -p app/components/chat app/components/agent app/components/skills
mkdir -p app/components/rag app/components/layout
mkdir -p app/composables app/stores app/assets/css app/pages

# 服务端
mkdir -p server/api/chat server/api/conversations server/api/agent
mkdir -p server/api/skills server/api/mcp server/api/rag/documents
mkdir -p server/services/llm server/services/agent
mkdir -p server/services/skills server/services/mcp server/services/rag
mkdir -p server/db/migrations server/utils

# 共享类型
mkdir -p shared/types
```

### 步骤 7：确认 Tailwind CSS v4

检查 `app/assets/css/main.css`，确保使用 v4 语法：

```css
@import "tailwindcss";
```

> Tailwind v4 使用 CSS 驱动配置（`@theme` 指令），不再需要 `tailwind.config.ts`。

---

## Phase 1：核心基础（预计 3-4 天）

### 开发顺序（重要！）

```
数据库 Schema → LLM Provider → SSE 工具 → /api/chat → 对话 CRUD → Chat UI → 暗黑模式
```

**不要跳过前面的步骤直接写 UI。** 详见 [开发思维转变](./2026-05-31-mindset.md)。

---

### 1.1 数据库 Schema + 连接实例

**文件**：`server/db/schema.ts`

核心表结构：

| 表 | 核心字段 | 说明 |
|----|---------|------|
| `conversations` | id (uuid 主键), title, model, provider, created_at, updated_at | 对话会话 |
| `messages` | id (uuid 主键), conversation_id (外键), role, content, tool_calls (jsonb), created_at | 对话消息 |

使用 Drizzle 的 `pg-core` 定义（不是 `mysql-core`）。

**文件**：`server/db/index.ts`

```ts
import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import * as schema from './schema'

const config = useRuntimeConfig()
const sql = neon(config.databaseUrl)
export const db = drizzle(sql, { schema })

export type DbClient = typeof db
```

> ⚠️ 只能使用 `drizzle-orm/neon-http`，禁止 `pg` / `node-postgres` / `postgres-js`。
>
> 💡 这里用 `useRuntimeConfig()` 而非 `process.env.DATABASE_URL`。原因是：① Nuxt 4 标准 pattern，无需装 `@types/node` 解决类型问题；② Nitro 原生管理，在 Cloudflare Workers 中更可靠；③ 所有环境变量在 `nuxt.config.ts` 中集中声明，便于维护。

**验证**：
```bash
npx drizzle-kit push     # 推送 Schema 到 Neon

# 验证表是否建好：
# 方式 1：Neon Dashboard → SQL Editor → 执行
#   SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
#   确认能看到 conversations 和 messages 两张表
#
# 方式 2：npx drizzle-kit studio（本地浏览器可视化工具）
```

---

### 1.2 LLM Provider 抽象层

**文件顺序**（类型先行）：

1. **`shared/types/provider.ts`** — `Message`、`ChatOptions`、`ToolDefinition` 前后端共享类型
2. **`server/services/llm/types.ts`** — `LLMProvider` 接口，`chat()` 返回 `ReadableStream<string>`
3. **`server/services/llm/openai.ts`** — OpenAI Provider 实现
4. **`server/services/llm/anthropic.ts`** — Anthropic Provider（SSE 格式与 OpenAI 不同，需适配）
5. **`server/services/llm/deepseek.ts`** — DeepSeek Provider（OpenAI 兼容接口，工具调用有差异）
6. **`server/services/llm/factory.ts`** — 工厂函数，按 provider ID 返回对应实例

> 💡 **已调研**：国内模型（千问、GLM、Kimi、MiniMax 等）几乎全部兼容 OpenAI 格式，复用 `openai.ts` 适配器即可。详见 [ADR-009: 国内模型 API 兼容性调研](../decisions/009-model-compatibility.md)。不集成 Vercel AI SDK，决定自建 Provider 抽象层以深入理解 LLM 调用细节，详见 [ADR-008: Vercel AI SDK 不集成决策](../decisions/008-vercel-ai-sdk.md)。

**统一输出**：所有 Provider 的 `chat()` 都返回 `ReadableStream<string>`，上层无需关心底层差异。

**兼容性说明**：

| Provider | SDK | Edge 兼容 |
|----------|-----|:---:|
| OpenAI | `openai` v4+（内置 `fetch`） | ✅ |
| Anthropic | `@anthropic-ai/sdk`（使用 `fetch`） | ⚠️ 需在 `wrangler pages dev` 验证 |
| DeepSeek | 直接用 `fetch` 调 OpenAI 兼容端点 | ✅ |

**`models` 构造参数 — OpenAI 格式复用的关键设计**：

接入 OpenAI 兼容的国内模型（千问、GLM、Kimi 等）时，复用 `OpenAIProvider` 但需要覆盖模型列表。通过 constructor 注入 `models` 参数实现：

```ts
// factory.ts 中接入千问
case 'qwen':
  return new OpenAIProvider({
    apiKey: config.qwenApiKey,
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [                              // 千问自己的模型白名单
      { id: 'qwen-max', name: '千问 Max', supportsTools: true },
      { id: 'qwen-plus', name: '千问 Plus', supportsTools: true },
    ],
  })
```

接入新模型只需三个构造参数：`baseURL`（往哪发请求）、`apiKey`（鉴权）、`models`（前端白名单）。不写新文件。

**环境变量方案补充**：如果不想安装 `@types/node`，可以在 `.env` 中使用 `NUXT_` 前缀（如 `NUXT_DATABASE_URL`），`nuxt.config.ts` 的 `runtimeConfig` 中用空字符串作为默认值，Nitro 会自动映射。详见 [Provider 实现记录](./2026-06-01-provider-implementation.md)。

> 📖 **深层架构理解**：[Provider 实现记录](./2026-06-01-provider-implementation.md) 覆盖了三层架构设计、`models()` 精选白名单的取舍逻辑、SSE 字节流手动解析的完整流程，以及两个实际踩坑记录。建议 Phase 1.2 写完 Provider 代码后阅读。

**验证**：写一个测试端点（如 `server/api/test-llm.get.ts`），用 `createLLMProvider()` 获取实例 → `provider.chat()` 拿到流 → `reader.read()` 收集 token，确认终端看到完整 AI 回复。

---

### 1.3 SSE 心跳工具

**文件**：`server/utils/sse.ts`

职责：
- 创建 `ReadableStream`，设置 SSE 响应头
- 每 30s 发送心跳 `event: ping\ndata: {}\n\n`（防止 Cloudflare 100s 空闲超时）
- 请求关闭时清理 `setInterval`
- 提供 `sendChunk()` 辅助函数，封装数据格式

**必须设置的响应头**：
```
Cache-Control: no-cache
Content-Type: text/event-stream
Connection: keep-alive
```

**数据格式**：
```
data: {"type":"text","content":"你好"}\n\n
event: ping\ndata: {}\n\n
```

---

### 1.4 `/api/chat` 端点

**文件**：`server/api/chat/index.post.ts`

处理流程：
1. 解析请求体（provider, model, messages, tools?）
2. 从 factory 获取 Provider 实例
3. 调用 `provider.chat()` 获得 `ReadableStream`
4. 用 SSE 工具包装后返回

**验证**：
```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai","model":"gpt-4o","messages":[{"role":"user","content":"你好"}]}'
```

终端中看到逐字流式输出 → 通过。

---

### 1.5 对话持久化

**API 路由**：

| 文件 | 方法 | 功能 |
|------|------|------|
| `server/api/conversations/index.get.ts` | GET | 对话列表 |
| `server/api/conversations/index.post.ts` | POST | 新建对话 |
| `server/api/conversations/[id].delete.ts` | DELETE | 删除对话 |

同时在 `/api/chat` 中增加自动保存逻辑：用户消息和 AI 回复写入 `messages` 表。

---

### 1.6 Chat UI

**组件树**：

```
app.vue
└── pages/index.vue
    ├── AppSidebar.vue
    │   └── ConversationList.vue      ← 对话列表 + 新建/删除
    └── ChatPanel.vue                  ← 主聊天区
        ├── AppHeader.vue
        │   └── ModelSelector.vue      ← 模型选择器 + 暗黑切换
        ├── ChatMessages.vue           ← Nuxt UI v4 ChatMessages
        └── ChatPrompt.vue             ← Nuxt UI v4 ChatPrompt
```

**核心 Composable**：`app/composables/useChat.ts`

职责：
- 管理消息列表状态
- 发起 SSE 连接（`fetch` + `ReadableStream` 消费）
- 处理 event type（text / tool_call / error / done）
- 断线自动重连（指数退避 + `Last-Event-ID`）

**关键提示**：
- 用 Nuxt UI v4 的 Chat 组件套件，不要自己从头写消息气泡
- SSE 客户端解析用 `response.body.getReader()` 逐行读取
- 流式消息实时追加到列表中最后一条 AI 消息

---

### 1.7 暗黑模式

**文件**：`app/composables/useTheme.ts`

Nuxt UI v4 内置 `useColorMode()`，只需封装：
- 当前主题状态（light / dark / system）
- `toggle()` 切换方法
- `localStorage` 持久化

在 `AppHeader.vue` 加一个 `UButton` 图标按钮切换。

---

## Phase 1 验证清单

```bash
# 1. 类型检查
npx nuxi typecheck

# 2. 开发服务器
npx nuxi dev

# 3. 端到端测试
# ✓ 新建对话 → 发送消息 → 流式返回
# ✓ 切换模型（OpenAI / Claude / DeepSeek）
# ✓ 切换对话 → 历史消息正确显示
# ✓ 删除对话
# ✓ 暗黑模式切换 + 刷新保持
# ✓ 关闭页面重开 → 对话列表正常
```

---

## 代码规范速查

### TypeScript

- 所有函数签名必须有明确类型，禁止 `any`
- `shared/types/` 是前后端契约，修改前考虑双向影响
- API 路由建议用 `zod` 做运行时校验

### 文件命名

| 类型 | 命名方式 | 示例 |
|------|---------|------|
| API 路由 | Nitro 文件系统约定 | `index.get.ts`、`[id].patch.ts` |
| Service | kebab-case | `openai.ts`、`factory.ts` |
| Vue 组件 | PascalCase | `ChatPanel.vue`、`ModelSelector.vue` |
| Composable | `use` + camelCase | `useChat.ts`、`useTheme.ts` |

### Git 提交规范

```
feat: add SSE heartbeat utility        # 新功能
fix: prevent heartbeat leak on close   # 修 bug
refactor: extract LLM types to shared  # 重构
chore: update drizzle-kit config       # 杂项
docs: add ADR for database choice      # 文档
```

每个 Phase 内的小任务（1.1、1.2…）单独提交。

### 禁止事项速查

| ❌ 禁止 | ✅ 替代 |
|---------|--------|
| `drizzle-orm/pg` / `node-postgres` / `postgres-js` | `drizzle-orm/neon-http` |
| `fs` / `child_process` / `net` | R2 存储 / HTTP MCP / `fetch()` |
| SSE 端点忘写心跳 | 30s `setInterval` + `event: ping` |
| 部署后不关压缩 | Cloudflare Dashboard 对 `/api/chat` 关闭 Brotli/Gzip |
| 自己 new 数据库连接 | 从 `server/db/index.ts` 导入 `db` |

---

## Phase 2-4 概览（后续参考）

| Phase | 核心挑战 | 前置依赖 |
|-------|---------|---------|
| **2: Agent + Skills** | ReAct 循环状态机、工具执行沙箱、Markdown Frontmatter 解析 | Phase 1 完整可用 |
| **3: MCP + 场景** | HTTP/SSE MCP 协议、JSON-RPC 格式、场景模板系统 | Phase 2 Agent Runtime |
| **4: RAG** | 文档分块策略（512 token 滑动窗口）、pgvector 查询、Embeddings 批处理 | 数据库有 pgvector、Phase 1 |

---

## 相关文档

- [开发思维转变](./2026-05-31-mindset.md) — 为什么必须后端优先
- [流式架构深层讨论](./2026-05-31-streaming-architecture.md) — 四段流式模型、为什么后端不可或缺
- [项目初始化记录](./2026-05-31-init.md) — .claude/ 配置
- [技术讨论：LangChain.js](./2026-05-31-discussion.md)
- [ADR-008: Vercel AI SDK 不集成](../decisions/008-vercel-ai-sdk.md)
- [ADR-009: 国内模型 API 兼容性](../decisions/009-model-compatibility.md)
- [架构设计](../../.claude/plan/architecture.md) — 完整架构图
- [实施路线图](../../.claude/plan/roadmap.md) — 任务清单
