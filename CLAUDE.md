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

Phase 1 核心基础已完成。Phase 1.5 第一轮（工程基础 1.8–1.15）全部完成。第二轮：1.16 错误反馈体系已完成，1.19 复制+重新生成已完成，1.20 代码高亮已完成，1.21 防重复创建+骨架屏已完成（搜索+折叠待做），1.17 SSE 重连推迟，1.28 增量写入 + 1.29 切换清理 + 1.30 后台流保持已完成（三项合并为流式架构 V2 升级，详见 [stream-architecture-v2](docs/dev-log/2026-06-27-stream-architecture-v2.md)）。1.23 设计规范体系已完成 — token 层（CSS 变量 + 动效 + 暗黑覆写）＋ 组件改造（圆角 token 化、错误态语义色、消息入场动画），详见 [ADR-011](docs/decisions/011-design-specification.md)。1.27 TS strict 已完成（Nuxt 4 默认 strict:true，typecheck 零错误）。1.31 API 单元测试推迟到 Phase 2。1.19 编辑重发、1.25 键盘快捷键已推迟（任务清单 + 状态见 @.claude/plan/roadmap.md）

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

`docs/` — 架构决策记录 (decisions/)、开发日志 (dev-log/)、Claude Code 技巧 (claude-tips/)、学习笔记 (learning-notes/)

### 开发日志速览

| 文档 | 内容 |
|------|------|
| [scaffold-guide](docs/dev-log/2026-05-31-scaffold-guide.md) | **项目初始化完整指南** — 从零搭建的分步操作手册 |
| [mindset](docs/dev-log/2026-05-31-mindset.md) | **开发思维转变** — 为什么必须后端优先，从"数据"往"界面"推 |
| [discussion](docs/dev-log/2026-05-31-discussion.md) | LangChain.js 集成评估 + Cloudflare 部署方案 |
| [init](docs/dev-log/2026-05-31-init.md) | .claude/ 配置记录 + 权限设计经验 |
| [streaming-architecture](docs/dev-log/2026-05-31-streaming-architecture.md) | **流式架构深层讨论** — 四段流式模型、为什么后端不可或缺、三个落地场景验证 |
| [provider-implementation](docs/dev-log/2026-06-01-provider-implementation.md) | **Provider 层实现记录** — 三层架构、`models()` 精选白名单、SSE 解析、OpenAI 格式复用公式 |
| [type-safety-review](docs/dev-log/2026-06-02-type-safety-review.md) | **Provider 类型安全审查** — `as` 断言 vs `switch` 穷尽性检查、tool 消息跨 Provider 映射表 |
| [provider-review-round2](docs/dev-log/2026-06-02-provider-review-round2.md) | **Provider 第二轮审查** — 构造参数一致性、`\|\|` vs `??` 空值陷阱、system prompt 统一 |
| [code-standards-setup](docs/dev-log/2026-06-02-code-standards-setup.md) | **代码规范配置指南** — ESLint 统一管理质量与风格、替代 Prettier、VS Code 集成 |
| [cicd-setup](docs/dev-log/2026-06-02-cicd-setup.md) | **CI/CD 初始配置** — Action 版本修正、Matrix 策略、首次拦截（runtimeConfig 类型安全）与扩展方向 |
| [sse-implementation](docs/dev-log/2026-06-03-sse-implementation.md) | **SSE 工具与 /api/chat 实现** — 两层 ReadableStream 包装、心跳机制、双环境兼容、调试方法 |
| [conversation-persistence-design](docs/dev-log/2026-06-03-conversation-persistence-design.md) | **对话持久化设计** — 三层工作分解、Schema 扩展、chat 改造核心约束、SSE 事件扩展、边界问题、实现级决策 |
| [code-review-conversation](docs/dev-log/2026-06-05-code-review-conversation.md) | **对话 CRUD + chat 端点代码审查** — Service 层缺失分析、SSE 工具重复代码量化、contentBuffer 累积发送 bug、N+1 查询、修复方案 |
| [frontend-dev-plan](docs/dev-log/2026-06-08-frontend-dev-plan.md) | **前端开发方案** — 项目现状审计、学习收益最大化策略、三阶段渐进式实施计划、SSE 消费端设计 |
| [perf-neon-latency](docs/dev-log/2026-06-16-perf-neon-latency.md) | **接口性能诊断** — Neon 延迟与串行查询叠加导致本地卡顿、中国到不同区域的路由实测、并行化方案 |
| [phase1-review](docs/dev-log/2026-06-18-phase1-review.md) | **Phase 1 全面审查** — 五大类 36 项问题、三层改造方案、工程基础改造记录（2.1–2.4 已完成）、讨论结论（11 节：6 项不做 + Sprint A/B 计划） |
| [regenerate-design](docs/dev-log/2026-06-22-regenerate-design.md) | **消息重新生成功能设计** — 方案 B 后端加 `regenerate` 参数、三步行为差异、竞态陷阱与修正 |
| [sprint-a-title-stream-error](docs/dev-log/2026-06-23-sprint-a-title-stream-error.md) | **Sprint A 实施：标题生成与流式错误态** — Path A/B 不对称性、`setCurrentConvId` 死代码、`isInitializing` 模式、`streamError` 生命周期 |
| [stream-interruption-protection](docs/dev-log/2026-06-23-stream-interruption-protection.md) | **流式中断保护方案** — SSE 重连推迟、两步走策略（第一步 35 行消灾难、第二步后台流保持）、核心洞察"流是独立后台任务，UI 只是观察窗口" |
| [stream-leakage-root-cause](docs/dev-log/2026-06-25-stream-leakage-root-cause.md) | **流式串话根因深度分析** — `messages` 全局单数组与对话无绑定（核心缺陷）、`useChat()` 三次独立实例化（放大缺陷）、两道防线修复（`streamingConvId` 校验 + watch abort）、后端双层 ReadableStream 分析 |
| [stream-architecture-v2](docs/dev-log/2026-06-27-stream-architecture-v2.md) | **流式架构 V2 完整实现** — 模块级单例 `useChat()`、`streamSessions` Map 管理多路并行流、`switchConversation` 切换保留后台流 + 切回恢复、服务端 `AbortSignal` 完整取消链、SSE 事件按 `conversationId` 路由、三层防线、META re-key |
| [ssr-state-hydration](docs/dev-log/2026-06-29-ssr-state-hydration.md) | **SSR 安全的状态持久化** — `useCookie` vs `localStorage`、水合机制、预渲染 vs SSR 取舍 |
| [ADR-008](docs/decisions/008-vercel-ai-sdk.md) | Vercel AI SDK 不集成，自建 Provider 抽象层 |
| [ADR-009](docs/decisions/009-model-compatibility.md) | 国内模型 API 兼容性调研与统一策略 |
| [ADR-010](docs/decisions/010-eslint-over-prettier.md) | ESLint stylistic rules 替代 Prettier |

### 学习笔记

| 文档 | 内容 |
|------|------|
| [nuxt4-notes](docs/learning-notes/nuxt4-notes.md) | Nuxt 4 学习笔记 |
| [cloudflare-edge-notes](docs/learning-notes/cloudflare-edge-notes.md) | Cloudflare Workers Edge Runtime 限制与应对 |
| [web-streams-api](docs/learning-notes/web-streams-api.md) | **Web Streams API 详解** — ReadableStream、TextEncoder、Response、fetch 等后端核心原语 |
