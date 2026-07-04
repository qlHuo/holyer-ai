# Holyer AI

个人 AI 系统 — 多模型对话、Agent 工具调用、Skills 系统、MCP 协议客户端、RAG 检索增强生成。

## 核心功能

- **多模型流式对话** — 统一入口，一键切换 OpenAI / Anthropic / DeepSeek 等模型，SSE 实时流式输出
- **对话管理** — 历史对话持久化、搜索、切换，后台流保持与切回恢复
- **Agent 智能体** `TODO` — ReAct 循环驱动，工具调用（搜索、计算、代码执行等），推理过程可视化
- **Skills 系统** `TODO` — 可复用的 Prompt 模板，一次定义、随时调用（代码审查、翻译、写作助手等）
- **MCP 客户端** `TODO` — 接入外部工具扩展能力边界（HTTP/SSE 传输）
- **RAG 知识库** `TODO` — 文档上传 → 向量检索 → 注入对话上下文，让 AI 感知你的私有知识

## 技术栈

| 层 | 技术 | 说明 |
|---|------|------|
| 框架 | **Nuxt 4** (Vue 3 + Nitro) | 全栈 SSR，前后端统一语言 |
| UI | **Nuxt UI v4** + Tailwind CSS v4 | 生产级 Chat 组件套件 |
| 数据库 | **Neon PostgreSQL** + pgvector | Serverless PG，HTTP 驱动 |
| ORM | **Drizzle ORM** (neon-http) | 类型安全查询，Edge 兼容 |
| AI | 自建 Provider 抽象层 | 统一接口，多厂商适配 |
| 部署 | **Cloudflare Pages** + Workers | 边缘计算，全球 CDN |

## 系统架构

```
┌──────────────────────────────────────────────────┐
│                  Cloudflare Pages                 │
│                                                   │
│  ┌─────────────── Nuxt 4 ───────────────────┐    │
│  │                                            │    │
│  │  Frontend (Vue 3)      Server (Nitro)      │    │
│  │  ┌─────────────────┐  ┌─────────────────┐ │    │
│  │  │ Chat UI          │  │ /api/chat (SSE) │ │    │
│  │  │ Agent 面板  TODO  │  │ /api/agent/run  │ │    │
│  │  │ Skills 管理 TODO  │  │ /api/skills     │ │    │
│  │  │ 知识库界面  TODO  │  │ /api/mcp/*      │ │    │
│  │  └─────────────────┘  │ /api/rag/*       │ │    │
│  │                        └────────┬────────┘ │    │
│  │                                 │           │    │
│  │                        ┌────────▼────────┐ │    │
│  │                        │  Services 层     │ │    │
│  │                        │  LLM             │ │    │
│  │                        │  Agent (TODO)    │ │    │
│  │                        │  Skills (TODO)   │ │    │
│  │                        │  MCP (TODO)      │ │    │
│  │                        │  RAG (TODO)      │ │    │
│  │                        └────────┬────────┘ │    │
│  │                                 │           │    │
│  │                        ┌────────▼────────┐ │    │
│  │                        │  Drizzle ORM     │ │    │
│  │                        └────────┬────────┘ │    │
│  └─────────────────────────────────┼──────────┘    │
│                                    │                │
└────────────────────────────────────┼────────────────┘
                                     │ HTTP
                         ┌───────────▼───────────┐
                         │   Neon PostgreSQL       │
                         │   + pgvector            │
                         └─────────────────────────┘
```

### 功能分层

```
┌──────────────────────────┐
│   垂直场景插槽层   TODO   │  ← 代码助手、写作助手、翻译...
├──────────────────────────┤
│   扩展能力层         TODO │
│   Skills │ MCP │ RAG     │  ← 可扩展的工具和知识
├──────────────────────────┤
│   智能体层           TODO │
│   Agent Runtime          │  ← ReAct 循环、工具调用
├──────────────────────────┤
│   核心基础层              │
│   多模型对话 + 流式       │  ← 已交付 ✅
└──────────────────────────┘
```

## 开发

```bash
# 安装依赖
pnpm install

# 启动开发服务器 (http://localhost:3000)
pnpm dev

# 类型检查
npx nuxi typecheck

# 数据库迁移
npx drizzle-kit push      # 推送 Schema
npx drizzle-kit generate  # 生成迁移文件
```

### 目录结构

```
holyer-ai/
├── app/                    # 前端 (Nuxt 4 pages, components, composables, stores)
├── server/
│   ├── api/                # Nitro API 路由
│   ├── services/           # 业务逻辑 (LLM, Agent, Skills, MCP, RAG)
│   ├── db/                 # Drizzle ORM + Schema
│   └── utils/              # 工具函数 (SSE, auth)
├── skills/                 # 内置技能 (Markdown 文件)
├── shared/types/           # 前后端共享类型
└── docs/                   # 设计文档 (ADR, dev-log, 学习笔记)
```

### 关键约束

- **数据库驱动** — 必须使用 `drizzle-orm/neon-http`，禁止 `pg` / `postgres-js`（Edge Runtime 仅支持 HTTP 连接）
- **SSE 心跳** — 所有流式端点必须每 30s 发送心跳，防止 Cloudflare 100s 空闲超时
- **Edge 兼容** — 引入依赖前检查是否依赖 Node.js 核心模块（`fs`、`child_process` 等不可用）
- **MCP 仅 HTTP/SSE** — 不支持 stdio 传输（无子进程）

## 部署

部署到 Cloudflare Pages（Workers 付费计划）：

```bash
# 构建
npx nuxi build

# 本地模拟 Cloudflare 环境
npx wrangler pages dev dist/

# 部署
npx wrangler pages deploy dist/
```

**部署后必须操作**：在 Cloudflare Dashboard 对 `/api/chat` 路由关闭 Brotli/Gzip 自动压缩（缓冲会破坏 SSE 实时流）。

### 环境变量

```bash
# 数据库
DATABASE_URL=postgresql://...           # Neon 连接池化 URL（含 -pooler.）

# LLM Provider
PROVIDER_OPENAI_API_KEY=sk-...
PROVIDER_ANTHROPIC_API_KEY=sk-ant-...
PROVIDER_DEEPSEEK_API_KEY=sk-...
```

## 相关文档

| 文档 | 说明 |
|------|------|
| [需求分析](.claude/plan/requirements.md) | 功能分层、痛点分析、边界定义 |
| [架构设计](.claude/plan/architecture.md) | 详细架构、模块设计、扩展方案 |
| [实施路线图](.claude/plan/roadmap.md) | Phase 1-4 任务分解与进度 |
| [技术调研](.claude/plan/technical-research.md) | 技术选型对比与决策依据 |
| [开发日志](docs/dev-log/) | 各功能模块实现记录 |
| [架构决策](docs/decisions/) | ADR（Architecture Decision Records） |
