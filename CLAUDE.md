# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 提供项目上下文。

## 项目概述

个人 AI 系统 — Nuxt 4 全栈应用，部署到 Cloudflare Workers（免费计划，域名 DNS 托管于 Cloudflare）。核心功能：多模型 LLM 流式对话、Agent 工具调用、Skills 系统、MCP 协议客户端、RAG 检索增强生成。

## 常用命令

```bash
npx nuxi dev                    # 开发服务器 (http://localhost:3000)
npx nuxi build                  # 构建 Cloudflare Workers 版本（nitro.preset: cloudflare-module）
npx drizzle-kit push            # 推送 Schema 到 Neon
npx drizzle-kit generate        # 生成迁移文件
npx drizzle-kit migrate         # 执行迁移
npx nuxi typecheck              # TypeScript 类型检查
```

## 技术架构

**技术栈**：Nuxt 4 (Vue 3 + Nitro) → Cloudflare Workers | Neon PostgreSQL + pgvector | Drizzle ORM (neon-http) | Nuxt UI v4 + Tailwind CSS v4

**核心模式**：Server API 路由 → Service 层 → 外部 API / 数据库。AI 响应通过 SSE 流式传输。所有 LLM Provider 实现统一接口（`server/service/llm/types.ts`），Factory 按 provider ID 返回实例，统一输出 `ReadableStream<string>`。

## 目录结构

| 目录 | 用途 |
|------|------|
| `app/` | Nuxt 4 前端（pages, components, composables, stores, api） |
| `app/api/` | 前端 API 封装层（$fetch 统一封装） |
| `server/api/` | Nitro API 路由 |
| `server/service/` | 业务逻辑（LLM Provider、Conversation、Agent/Skills/MCP/RAG） |
| `server/db/` | Drizzle ORM 实例 + Schema |
| `skills/` | 应用级技能 ⬜ P2（面向最终用户） |
| `.claude/skills/` | 开发期 Agent 技能（辅助项目开发） |
| `.claude/commands/` | 自定义斜杠命令 |
| `shared/types/` | 前后端共享 TypeScript 类型 |

## 关键陷阱

这是 Claude 最容易踩的坑，**每条都必须遵守**：

- **Cloudflare 100s 空闲超时**：SSE 端点必须每 30s 发送 `event: ping\ndata: {}\n\n` 心跳，否则连接会被切断
- **数据库驱动限制**：生产环境必须使用 `drizzle-orm/neon-http`，禁止 `pg` / `node-postgres`。开发环境通过 `import.meta.dev` 分支使用 `postgres-js`（纯 JS，Edge 兼容），但生产 DRIVER 只能是 neon-http
- **SSE 压缩禁用**：部署后必须在 Cloudflare Dashboard 对 `/api/chat` 关闭 Brotli/Gzip 自动压缩（缓冲会破坏实时流）
- **Edge Runtime 无 Node API**：`fs`、`child_process`、`net` (TCP Socket) 在生产环境全部不可用，引入新依赖前检查
- **MCP 仅 HTTP/SSE**：不支持 stdio 传输（无子进程）

## 代码生成优先级

生成任何代码时，按以下优先级选择实现方式。**禁止跳过前面的层级直接自己写**：

1. **项目自身规范** — 先查 `.claude/rules/` 中对应领域的规则文件（前端/API/数据库/LLM），项目已有的同类文件/函数就是模板
2. **已引入库的官方用法** — 安装了就要用，不要无视。例如：Nuxt UI v4 的 `<UForm>` + Zod 校验（而非手写 `<div>` + `<input>` + 自己写 validate）、Drizzle ORM 类型安全 API（而非原始 SQL）、Pinia Setup Store（而非 Option Store）
3. **业界通用最佳实践** — TypeScript 严格类型、RESTful 语义、SSE 标准模式
4. **自定义实现** — 仅在前 3 层都无法满足需求时才自己造

**反例警示**：实现提示词管理时，表单直接用 `<div>` + `<input>` + `<textarea>` 手写，而项目已安装 Nuxt UI v4（内置 Form 组件）和 Zod（已在 API 端大量使用），这就是跳过了第 2 层。正确做法：`<UForm>` + `z.object({...})` + `useForm()`。

详见 [代码生成优先级规则](.claude/rules/code-generation-priority.md)。

## 非做不可

这些规则没有例外，违反会直接导致生产故障：

1. 数据库查询必须从 `server/db/index.ts` 导入 `db` 实例，不许自己创建连接
2. 所有 SSE 端点必须包含心跳机制（`server/utils/sse.ts`）
3. 新 npm 依赖必须兼容 Edge Runtime（无 Node.js 核心模块依赖）
4. `DATABASE_URL` 必须使用 Neon 连接池化 URL（含 `-pooler.`）
5. Nuxt UI 组件用 v4 版本 API（不是 v3），引用 Nuxt UI v4 文档

## 当前进度

Phase 1 + 1.5 + 2 全部完成 ✅（Phase 2 = Prompt 管理 + Agent Runtime + 工具系统，2026-08-18 全链路审查收尾）。

下一步 **Phase 3 = RAG 知识库**——2026-08-25 与 MCP 对调后先行，从阶段 A「管道验证」起步（纯脚本，召回命中率 >80% 才做 UI）。MCP 顺延为 Phase 4。

进度快照 [status.md](.claude/plan/status.md) · 全量规划 [roadmap](.claude/plan/roadmap.md) · 推迟项 [todo.md](.claude/plan/todo.md)。

## 开发期技能

| 技能 | 文件 | 用途 |
|------|------|------|
| `/doc-consolidate` | `.claude/skills/doc-consolidate/SKILL.md` | 文档沉淀 — 斜杠命令 `/doc-consolidate` 或自然语言触发，Agent 可自动识别 |

## 项目文档

- **设计文档**：[需求分析](.claude/plan/requirements.md) · [架构设计](.claude/plan/architecture.md) · [实施路线图](.claude/plan/roadmap.md)
- **文档索引**：[docs/INDEX.md](docs/INDEX.md) — 43 篇文档的中心索引（ADR、开发日志、学习笔记、技巧）
- **开发规则**：[`.claude/rules/`](.claude/rules/) — 前端、Edge Runtime、SSE、数据库专项规则
