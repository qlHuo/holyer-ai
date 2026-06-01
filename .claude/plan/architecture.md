# 架构设计

> 关联文档：[技术调研](technical-research.md) · [需求分析](requirements.md) · [实施路线图](roadmap.md) · [扩展性设计](extensibility.md)

---

## 1. 总体架构

```
┌─────────────────────────────────────────────────────────┐
│                   Cloudflare Pages                       │
│                                                          │
│  ┌───────────────────  Nuxt 4 ──────────────────────┐   │
│  │                                                    │   │
│  │  Frontend (Vue 3)           Server (Nitro/Worker)  │   │
│  │  ┌──────────────────┐    ┌──────────────────────┐ │   │
│  │  │ Nuxt UI v4       │    │ /api/chat    (SSE)   │ │   │
│  │  │ ├ ChatMessages   │    │ /api/agent/run       │ │   │
│  │  │ ├ ChatPrompt    │    │ /api/skills          │ │   │
│  │  │ ├ ChatReasoning │    │ /api/mcp/*           │ │   │
│  │  │ └ ChatTool      │    │ /api/rag/*           │ │   │
│  │  └──────────────────┘    │ /api/conversations   │ │   │
│  │                           └──────────┬───────────┘ │   │
│  │                                      │              │   │
│  │                      ┌───────────────▼───────────┐ │   │
│  │                      │      Services Layer       │ │   │
│  │                      │  LLM / Agent / Skills     │ │   │
│  │                      │  MCP   / RAG              │ │   │
│  │                      └───────────────┬───────────┘ │   │
│  │                                      │              │   │
│  │                      ┌───────────────▼───────────┐ │   │
│  │                      │  Drizzle ORM (neon-http)  │ │   │
│  │                      └───────────────┬───────────┘ │   │
│  └──────────────────────────────────────┼──────────────┘   │
│                                         │                   │
└─────────────────────────────────────────┼───────────────────┘
                                          │ HTTP
                              ┌───────────▼───────────┐
                              │   Neon PostgreSQL      │
                              │   + pgvector           │
                              └───────────────────────┘
```

---

## 2. 目录结构

```
holyer-ai/
├── app/                          # Nuxt 4 前端目录
│   ├── app.vue                   # 根组件
│   ├── pages/                    # 路由页面
│   │   └── index.vue             # 主聊天页
│   ├── components/               # Vue 组件
│   │   ├── chat/
│   │   │   ├── ChatPanel.vue     # 聊天主面板
│   │   │   ├── ConversationList.vue  # 对话列表
│   │   │   └── ModelSelector.vue # 模型选择器
│   │   ├── agent/
│   │   │   ├── AgentPanel.vue    # Agent 状态面板
│   │   │   └── ToolCallCard.vue  # 工具调用卡片
│   │   ├── skills/
│   │   │   └── SkillsManager.vue
│   │   ├── rag/
│   │   │   ├── DocumentUpload.vue
│   │   │   └── KnowledgeBase.vue
│   │   └── layout/
│   │       ├── AppSidebar.vue
│   │       └── AppHeader.vue
│   ├── composables/              # 组合式函数
│   │   ├── useChat.ts            # SSE 流式聊天
│   │   ├── useAgent.ts           # Agent 状态
│   │   └── useTheme.ts           # 暗黑模式
│   └── stores/                   # Pinia 状态
│       ├── chat.store.ts
│       └── settings.store.ts
│
├── server/                       # Nitro 服务端
│   ├── api/                      # API 路由
│   │   ├── chat/
│   │   │   └── index.post.ts     # SSE 流式对话
│   │   ├── conversations/
│   │   │   ├── index.get.ts
│   │   │   ├── index.post.ts
│   │   │   └── [id].delete.ts
│   │   ├── agent/
│   │   │   └── run.post.ts
│   │   ├── skills/
│   │   │   ├── index.get.ts
│   │   │   └── [name].get.ts
│   │   ├── mcp/
│   │   │   ├── servers.get.ts
│   │   │   └── tools.get.ts
│   │   └── rag/
│   │       ├── documents/
│   │       │   ├── index.get.ts
│   │       │   └── index.post.ts
│   │       └── search.post.ts
│   │
│   ├── services/                 # 业务逻辑层
│   │   ├── llm/
│   │   │   ├── types.ts          # LLMProvider 接口
│   │   │   ├── factory.ts        # Provider 工厂
│   │   │   ├── openai.ts
│   │   │   ├── anthropic.ts
│   │   │   └── deepseek.ts
│   │   ├── agent/
│   │   │   ├── runtime.ts        # ReAct 循环
│   │   │   ├── tools.ts          # 内置工具注册
│   │   │   └── memory.ts         # 上下文管理
│   │   ├── skills/
│   │   │   ├── registry.ts       # 技能注册中心
│   │   │   └── loader.ts         # Markdown 解析
│   │   ├── mcp/
│   │   │   └── client.ts         # MCP HTTP/SSE 客户端
│   │   └── rag/
│   │       ├── chunker.ts        # 文档分块
│   │       ├── embeddings.ts     # 嵌入生成
│   │       └── retriever.ts      # 检索策略
│   │
│   ├── db/
│   │   ├── index.ts              # Drizzle + Neon HTTP
│   │   └── schema.ts             # 数据表定义
│   │
│   └── utils/
│       ├── sse.ts                # SSE 心跳工具
│       └── auth.ts               # API Key 校验
│
├── skills/                       # 内置技能（Markdown 文件）
│   ├── code-review.md
│   └── translator.md
│
├── shared/                       # 前后端共享类型
│   └── types/
│       ├── chat.ts
│       ├── agent.ts
│       ├── skill.ts
│       ├── mcp.ts
│       └── provider.ts
│
├── nuxt.config.ts                # Nuxt 4 配置
├── wrangler.jsonc                # Cloudflare 绑定
├── drizzle.config.ts             # Drizzle 配置
├── tailwind.config.ts            # Tailwind CSS v4
├── tsconfig.json
└── package.json
```

---

## 3. 核心模块设计

### 3.1 LLM Provider 抽象层

```ts
// server/services/llm/types.ts
interface LLMProvider {
  id: string
  chat(messages: Message[], options: ChatOptions): Promise<ReadableStream<string>>
  models(): ModelInfo[]
}

interface ChatOptions {
  model: string
  temperature?: number
  maxTokens?: number
  tools?: ToolDefinition[]
  systemPrompt?: string
}
```

| Provider | 端点 | 要点 |
|----------|------|------|
| OpenAI | `/v1/chat/completions` | `stream: true`，工具调用最可靠 |
| Anthropic | `/v1/messages` | SSE 流格式不同需适配 |
| DeepSeek | OpenAI 兼容接口 | 工具调用实现有差异 |

**流式统一**：所有 Provider 都适配为 `ReadableStream<string>`，由 SSE 工具函数统一发送。

> 📋 **相关决策**：[ADR-008 不集成 Vercel AI SDK](../../docs/decisions/008-vercel-ai-sdk.md) · [ADR-009 国内模型兼容性](../../docs/decisions/009-model-compatibility.md) — 国内模型（千问、GLM、Kimi 等）几乎全部兼容 OpenAI 格式，复用同一个适配器即可。
> 📖 **实现记录**：[Provider 实现记录](../../docs/dev-log/2026-06-01-provider-implementation.md) — 三层架构详解、`models()` 精选白名单设计、SSE 字节流解析、OpenAI 格式复用公式（`baseURL + apiKey + models`）。
> 🔍 **审查记录**：[Provider 类型安全审查](../../docs/dev-log/2026-06-02-type-safety-review.md) — `as` 断言风险分析、`switch` 穷尽性检查模式、tool 消息跨 Provider 映射表。

### 3.2 Agent Runtime

```
用户消息 → 构建上下文 (system + tools + history)
  → LLM 调用 → 返回 文本 | 工具调用
  → 如果工具调用：
     → 提取 name + args → 执行工具 → 结果追加到上下文 → 循环（默认最多 10 轮）
  → 如果是文本 → 流式返回用户
```

内置工具：网页搜索、代码执行（沙箱）、计算器、当前时间。

### 3.3 Skills 系统

```markdown
---
name: code-review
description: 代码审查专家
tools: [read-file, search-code]
model: claude-sonnet-4-6
---

# Role
你是一个资深代码审查专家。请从以下维度审查代码：

## 检查清单
1. 安全性（SQL 注入、XSS、敏感信息泄露）
2. 性能（不必要的重渲染、内存泄漏）
3. 可维护性（命名、模块化、注释）
```

Skill 即 Markdown 文件：Frontmatter 定义元数据，正文是 System Prompt。

### 3.4 MCP Client

支持 HTTP + SSE 传输（Cloudflare Workers 不支持 stdio 子进程）：

```ts
interface MCPClient {
  connect(serverUrl: string): Promise<void>
  listTools(): Promise<MCPTool[]>
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>
  disconnect(): void
}
```

### 3.5 RAG 管道

```
文档上传 → 解析 → 分块 (512 tokens, 滑动窗口)
  → OpenAI Embeddings (1536d) → pgvector 存储
  → 查询时：问题嵌入 → 余弦相似度 Top-K → 注入 LLM 上下文
```

### 3.6 SSE 心跳机制

```ts
// server/utils/sse.ts
function createSSEStream(request: H3Event) {
  const stream = new ReadableStream({ ... })
  // 每 30s 发送心跳，防止 Cloudflare 100s 空闲超时
  const heartbeat = setInterval(() => {
    controller.enqueue('event: ping\ndata: {}\n\n')
  }, 30000)
  // 流结束时清理
  request.node.req.on('close', () => clearInterval(heartbeat))
  return stream
}
```

---

## 4. 扩展性设计

### 4.1 垂直场景插件机制

每个垂直场景 = 一个 Skill + 可选的自定义 UI：

```
垂直场景 = {
  skill:       Skill 定义（Prompt + Tools）
  model:       推荐模型
  ui?:         可选的自定义组件（如代码审查的 diff 视图）
  tools:       场景专属工具
  knowledge?:  预置知识库
}
```

### 4.2 Provider 扩展

添加新模型只需：
1. 实现 `LLMProvider` 接口
2. 在 `factory.ts` 注册
3. UI 自动从 `models()` 获取模型列表

### 4.3 工具扩展

添加工具只需：
1. 定义 `Tool` 对象（name, description, parameters, execute）
2. 在 `tools.ts` 注册
3. Agent 自动发现并调用

---

## 5. 技术栈定稿

| 层 | 技术 | 版本 |
|---|------|------|
| 框架 | Nuxt 4 | ^4.4 |
| UI | Nuxt UI v4 | ^4.7 |
| 样式 | Tailwind CSS | v4 |
| 语言 | TypeScript | ^5.8 |
| 数据库 | Neon PostgreSQL + pgvector | - |
| ORM | Drizzle ORM (neon-http) | ^0.44 |
| 部署 | Cloudflare Pages + Workers | 付费计划 |
| AI SDK | 自定义 Provider 抽象（Edge 兼容） | - |
| 认证 | 简单 API Key（初期） | - |

> 关于用户登录、API Key 管理、权限控制的扩展方案，详见 [扩展性设计](extensibility.md)。
