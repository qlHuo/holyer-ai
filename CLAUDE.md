# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 提供项目上下文。

## 项目概述

个人 AI 系统 — Nuxt 4 全栈应用，部署到 Cloudflare Pages。核心功能：多模型 LLM 流式对话、Agent 工具调用、Skills 系统、MCP 协议客户端、RAG 检索增强生成。

## 常用命令

```bash
npx nuxi dev                    # 开发服务器 (http://localhost:3000)
npx nuxi build                  # 构建 Cloudflare Pages 版本
npx wrangler pages dev dist/    # 本地模拟 Cloudflare 环境
npx drizzle-kit push            # 推送 Schema 到 Neon
npx drizzle-kit generate        # 生成迁移文件
npx drizzle-kit migrate         # 执行迁移
npx nuxi typecheck              # TypeScript 类型检查
```

## 技术架构

**技术栈**：Nuxt 4 (Vue 3 + Nitro) → Cloudflare Pages | Neon PostgreSQL + pgvector | Drizzle ORM (neon-http) | Nuxt UI v4 + Tailwind CSS v4

**核心模式**：Server API 路由 → Service 层 → 外部 API / 数据库。AI 响应通过 SSE 流式传输。所有 LLM Provider 实现统一接口（`server/services/llm/types.ts`），Factory 按 provider ID 返回实例，统一输出 `ReadableStream<string>`。

## 目录结构

| 目录 | 用途 |
|------|------|
| `app/` | Nuxt 4 前端（pages, components, composables, stores） |
| `server/api/` | Nitro API 路由 |
| `server/services/` | 业务逻辑（LLM Provider、Agent、Skills、MCP、RAG） |
| `server/db/` | Drizzle ORM 实例 + Schema |
| `skills/` | 应用级技能（面向最终用户） |
| `.claude/skills/` | 开发期 Agent 技能（辅助项目开发） |
| `.claude/commands/` | 自定义斜杠命令 |
| `shared/types/` | 前后端共享 TypeScript 类型 |

## 关键陷阱

这是 Claude 最容易踩的坑，**每条都必须遵守**：

- **Cloudflare 100s 空闲超时**：SSE 端点必须每 30s 发送 `event: ping\ndata: {}\n\n` 心跳，否则连接会被切断
- **数据库驱动限制**：必须使用 `drizzle-orm/neon-http`，禁止 `pg` / `node-postgres` / `postgres-js` — Edge Runtime 只支持 HTTP 连接
- **SSE 压缩禁用**：部署后必须在 Cloudflare Dashboard 对 `/api/chat` 关闭 Brotli/Gzip 自动压缩（缓冲会破坏实时流）
- **Edge Runtime 无 Node API**：`fs`、`child_process`、`net` (TCP Socket) 在生产环境全部不可用，引入新依赖前检查
- **MCP 仅 HTTP/SSE**：不支持 stdio 传输（无子进程）

## 非做不可

这些规则没有例外，违反会直接导致生产故障：

1. 数据库查询必须从 `server/db/index.ts` 导入 `db` 实例，不许自己创建连接
2. 所有 SSE 端点必须包含心跳机制（`server/utils/sse.ts`）
3. 新 npm 依赖必须兼容 Edge Runtime（无 Node.js 核心模块依赖）
4. `DATABASE_URL` 必须使用 Neon 连接池化 URL（含 `-pooler.`）
5. Nuxt UI 组件用 v4 版本 API（不是 v3），引用 Nuxt UI v4 文档

## 当前进度

实施 Phase 1 — 核心基础（任务清单 + 状态见 @.claude/plan/roadmap.md）

## 自定义命令

| 命令 | 文件 | 用途 |
|------|------|------|
| `/doc-consolidate` | `.claude/commands/doc-consolidate.md` | 将技术讨论沉淀为项目文档（ADR/dev-log），自动分类、去重、交叉引用 |

## 开发期技能（Agent 系统，Phase 2 启用）

| 技能 | 文件 | 触发方式 |
|------|------|---------|
| `doc-consolidator` | `.claude/skills/doc-consolidator.md` | 手动：用户说"归档"/"记录下来"；自动（Phase 3+）：完成重大决策讨论后 |

## 设计文档

@.claude/plan/requirements.md
@.claude/plan/architecture.md

## 项目文档

@docs/ — 架构决策记录 (decisions/)、开发日志 (dev-log/)、Claude Code 技巧 (claude-tips/)、学习笔记 (learning-notes/)

### 开发日志速览

| 文档 | 内容 |
|------|------|
| @docs/dev-log/2026-05-31-scaffold-guide.md | **项目初始化完整指南** — 从零搭建的分步操作手册 |
| @docs/dev-log/2026-05-31-mindset.md | **开发思维转变** — 为什么必须后端优先，从"数据"往"界面"推 |
| @docs/dev-log/2026-05-31-discussion.md | LangChain.js 集成评估 + Cloudflare 部署方案 |
| @docs/dev-log/2026-05-31-init.md | .claude/ 配置记录 + 权限设计经验 |
| @docs/dev-log/2026-05-31-streaming-architecture.md | **流式架构深层讨论** — 四段流式模型、为什么后端不可或缺、三个落地场景验证 |
| @docs/dev-log/2026-06-01-provider-implementation.md | **Provider 层实现记录** — 三层架构、`models()` 精选白名单、SSE 解析、OpenAI 格式复用公式 |
| @docs/dev-log/2026-06-02-type-safety-review.md | **Provider 类型安全审查** — `as` 断言 vs `switch` 穷尽性检查、tool 消息跨 Provider 映射表 |
| @docs/dev-log/2026-06-02-code-standards-setup.md | **代码规范配置指南** — ESLint 统一管理质量与风格、替代 Prettier、VS Code 集成 |
| @docs/dev-log/2026-06-02-cicd-setup.md | **CI/CD 初始配置** — Action 版本修正、Matrix 策略、当前阶段价值与扩展方向 |
| @docs/decisions/008-vercel-ai-sdk.md | **ADR-008** — Vercel AI SDK 不集成，自建 Provider 抽象层 |
| @docs/decisions/009-model-compatibility.md | **ADR-009** — 国内模型 API 兼容性调研与统一策略 |
| @docs/decisions/010-eslint-over-prettier.md | **ADR-010** — ESLint stylistic rules 替代 Prettier |
