# 文档索引

> 48 篇项目文档的中心索引。新增文档后更新此文件（也可通过 `/doc-consolidate` 自动维护）。

---

## 架构决策记录（14 篇）

`docs/decisions/` — 涉及"选了 A 而不是 B"的不可逆技术决策。

| 编号 | 文件 | 决策 |
|------|------|------|
| ADR-001 | [001-nuxt4-fullstack](decisions/001-nuxt4-fullstack.md) | Nuxt 4 全栈方案 |
| ADR-002 | [002-nuxt-ui-v4](decisions/002-nuxt-ui-v4.md) | Nuxt UI v4 组件库 |
| ADR-003 | [003-neon-drizzle](decisions/003-neon-drizzle.md) | Neon PostgreSQL + Drizzle ORM |
| ADR-004 | [004-cloudflare-pages](decisions/004-cloudflare-pages.md) | Cloudflare Workers 部署 |
| ADR-005 | [005-document-naming](decisions/005-document-naming.md) | 项目文档英文命名 |
| ADR-006 | [006-docs-directory](decisions/006-docs-directory.md) | docs/ 目录结构与 .claude/ 分离 |
| ADR-007 | [007-claude-rules-structure](decisions/007-claude-rules-structure.md) | .claude/rules/ 按技术域分层 |
| ADR-008 | [008-vercel-ai-sdk](decisions/008-vercel-ai-sdk.md) | Vercel AI SDK — 不集成，自建 Provider 抽象层 |
| ADR-009 | [009-model-compatibility](decisions/009-model-compatibility.md) | 国内模型 API 兼容性调研与统一策略 |
| ADR-010 | [010-eslint-over-prettier](decisions/010-eslint-over-prettier.md) | ESLint stylistic rules 替代 Prettier |
| ADR-011 | [011-design-specification](decisions/011-design-specification.md) | 设计规范体系（配色/字体/间距/圆角/阴影/动效） |
| ADR-012 | [012-llm-stream-chunk-type](decisions/012-llm-stream-chunk-type.md) | `chat()` 返回类型升级为 `ReadableStream<LLMStreamChunk>` |
| ADR-013 | [013-prompt-naming](decisions/013-prompt-naming.md) | 统一命名为 Prompt（自定义提示词模板），Phase 2 第一步实现 |
| ADR-014 | [014-agent-streaming-db-write](decisions/014-agent-streaming-db-write.md) | Agent 流式 DB 写入策略（一次性写入，已知让步） |

---

## 开发日志（26 篇）

`docs/dev-log/` — 深层讨论、核心概念澄清、设计推演、Bug 排查。

### 2026-07

| 日期 | 文件 | 内容 |
|------|------|------|
| 07-10 | [ai-sdk-decision-and-learning-path](dev-log/2026-07-10-ai-sdk-decision-and-learning-path.md) | **AI SDK 引入决策 + ReAct 循环学习路径** — 混合架构、手写→切换两阶段、Provider 层不动 |
| 07-09 | [prompt-engineering-and-phase2-planning](dev-log/2026-07-09-prompt-engineering-and-phase2-planning.md) | **提示词工程认知澄清与 Phase 2 前规划 review** — PromptSegment 抽象、Agent 可观测性、安全护栏 |
| 07-05 | [cloudflare-worker-build-oom](dev-log/2026-07-05-cloudflare-worker-build-oom.md) | **CF Worker 构建 OOM 修复** — 缺失 `nitro.preset` 导致全量打包、双管线构建架构解析 |
| 07-03 | [chatinput-welcome-redesign](dev-log/2026-07-03-chatinput-welcome-redesign.md) | **ChatInput 双区域重构 + 欢迎页快速操作** — textarea vs contenteditable 决策、统一卡片方案 |
| 07-01 | [markdown-mermaid-implementation](dev-log/2026-07-01-markdown-mermaid-implementation.md) | **Markdown 渲染与 Mermaid 图表实现** — markdown-it 管线、三个 Bug 根因与修复 |

### 2026-06

| 日期 | 文件 | 内容 |
|------|------|------|
| 06-29 | [ssr-state-hydration](dev-log/2026-06-29-ssr-state-hydration.md) | **SSR 安全的状态持久化** — useCookie vs localStorage、水合机制 |
| 06-27 | [stream-architecture-v2](dev-log/2026-06-27-stream-architecture-v2.md) | **流式架构 V2 完整实现** — 模块级单例、多路并行流、三层防线、META re-key |
| 06-25 | [stream-leakage-root-cause](dev-log/2026-06-25-stream-leakage-root-cause.md) | **流式串话根因深度分析** — messages 全局单数组、useChat() 三次实例化 |
| 06-23 | [stream-interruption-protection](dev-log/2026-06-23-stream-interruption-protection.md) | **流式中断保护方案** — 核心洞察"流是独立后台任务，UI 只是观察窗口" |
| 06-23 | [sprint-a-title-stream-error](dev-log/2026-06-23-sprint-a-title-stream-error.md) | **Sprint A 实施：标题生成与流式错误态** — Path A/B 不对称性 |
| 06-22 | [regenerate-design](dev-log/2026-06-22-regenerate-design.md) | **消息重新生成功能设计** — 方案 B、三步行为差异、竞态陷阱 |
| 06-18 | [phase1-review](dev-log/2026-06-18-phase1-review.md) | **Phase 1 全面审查** — 五大类 36 项问题、三层改造方案 |
| 06-16 | [perf-neon-latency](dev-log/2026-06-16-perf-neon-latency.md) | **接口性能诊断** — Neon 延迟、中国到不同区域路由实测、并行化方案 |
| 06-08 | [frontend-dev-plan](dev-log/2026-06-08-frontend-dev-plan.md) | **前端开发方案** — 项目现状审计、三阶段渐进式实施计划 |
| 06-05 | [code-review-conversation](dev-log/2026-06-05-code-review-conversation.md) | **对话 CRUD + chat 端点代码审查** — Service 层缺失、N+1 查询、修复方案 |
| 06-03 | [conversation-persistence-design](dev-log/2026-06-03-conversation-persistence-design.md) | **对话持久化设计** — 三层工作分解、Schema 扩展、SSE 事件扩展 |
| 06-03 | [sse-implementation](dev-log/2026-06-03-sse-implementation.md) | **SSE 工具与 /api/chat 实现** — 两层 ReadableStream 包装、心跳机制 |
| 06-02 | [provider-review-round2](dev-log/2026-06-02-provider-review-round2.md) | **Provider 第二轮审查** — 构造参数一致性、`\|\|` vs `??` 空值陷阱 |
| 06-02 | [type-safety-review](dev-log/2026-06-02-type-safety-review.md) | **Provider 类型安全审查** — `as` 断言 vs `switch` 穷尽性检查 |
| 06-02 | [code-standards-setup](dev-log/2026-06-02-code-standards-setup.md) | **代码规范配置指南** — ESLint 统一管理质量与风格、替代 Prettier |
| 06-02 | [cicd-setup](dev-log/2026-06-02-cicd-setup.md) | **CI/CD 初始配置** — Action 版本修正、Matrix 策略 |
| 06-01 | [provider-implementation](dev-log/2026-06-01-provider-implementation.md) | **Provider 层实现记录** — 三层架构、models() 精选白名单、SSE 解析 |

### 2026-05

| 日期 | 文件 | 内容 |
|------|------|------|
| 05-31 | [streaming-architecture](dev-log/2026-05-31-streaming-architecture.md) | **流式架构深层讨论** — 四段流式模型、为什么后端不可或缺 |
| 05-31 | [scaffold-guide](dev-log/2026-05-31-scaffold-guide.md) | **项目初始化完整指南** — 从零搭建的分步操作手册 |
| 05-31 | [mindset](dev-log/2026-05-31-mindset.md) | **开发思维转变** — 为什么必须后端优先，从"数据"往"界面"推 |
| 05-31 | [discussion](dev-log/2026-05-31-discussion.md) | LangChain.js 集成评估 + Cloudflare 部署方案 |
| 05-31 | [init](dev-log/2026-05-31-init.md) | .claude/ 配置记录 + 权限设计经验 |

---

## Claude Code 技巧（4 篇）

`docs/claude-tips/` — 工具使用经验、权限配置心得。

| 文件 | 内容 |
|------|------|
| [advanced-features-guide](claude-tips/advanced-features-guide.md) | **进阶功能实战指南** — 全景速览 + 场景驱动的用法指南（Rules/Commands/Skills/Subagents/Hooks/Memory/Plan Mode），含学习路线 |
| [commands-vs-skills](claude-tips/commands-vs-skills.md) | **Commands vs Skills + 子代理** — 两种扩展机制的区别、触发方式、最佳实践 |
| [hooks-guide](claude-tips/hooks-guide.md) | Claude Code Hook 指南 — 事件触发自动行为 |
| [permissions-guide](claude-tips/permissions-guide.md) | Claude Code 权限配置指南 — 精细化权限控制 |

---

## 学习笔记（3 篇）

`docs/learning-notes/` — 新技术知识点梳理。

| 文件 | 内容 |
|------|------|
| [nuxt4-notes](learning-notes/nuxt4-notes.md) | Nuxt 4 学习笔记 |
| [cloudflare-edge-notes](learning-notes/cloudflare-edge-notes.md) | Cloudflare Workers Edge Runtime 限制与应对 |
| [web-streams-api](learning-notes/web-streams-api.md) | **Web Streams API 详解** — ReadableStream、TextEncoder、Response |

---

## 核心设计文档

`.claude/plan/` — 项目规划与架构核心文档。

| 文件 | 内容 |
|------|------|
| [requirements.md](../.claude/plan/requirements.md) | 需求分析 — 痛点、功能分层、不做的事 |
| [architecture.md](../.claude/plan/architecture.md) | 架构设计 — 目录结构、核心模块、扩展性 |
| [roadmap.md](../.claude/plan/roadmap.md) | 实施路线图 — Phase 1-4 任务分解与状态 |
| [phase2-agent-design.md](../.claude/plan/phase2-agent-design.md) | **Phase 2 Agent 系统设计方案** — 6 个架构决策、Provider 精简、ReAct 循环、Prompt 系统、学习路径 |

---

## 主题速查

按技术主题快速定位相关文档：

| 主题 | 相关文档 |
|------|---------|
| **LLM Provider 层** | [ADR-008](decisions/008-vercel-ai-sdk.md) · [ADR-009](decisions/009-model-compatibility.md) · [provider-implementation](dev-log/2026-06-01-provider-implementation.md) · [type-safety-review](dev-log/2026-06-02-type-safety-review.md) · [provider-review-round2](dev-log/2026-06-02-provider-review-round2.md) |
| **SSE 流式架构** | [streaming-architecture](dev-log/2026-05-31-streaming-architecture.md) · [sse-implementation](dev-log/2026-06-03-sse-implementation.md) · [stream-leakage-root-cause](dev-log/2026-06-25-stream-leakage-root-cause.md) · [stream-interruption-protection](dev-log/2026-06-23-stream-interruption-protection.md) · [stream-architecture-v2](dev-log/2026-06-27-stream-architecture-v2.md) |
| **对话持久化** | [conversation-persistence-design](dev-log/2026-06-03-conversation-persistence-design.md) · [code-review-conversation](dev-log/2026-06-05-code-review-conversation.md) · [regenerate-design](dev-log/2026-06-22-regenerate-design.md) |
| **前端架构** | [frontend-dev-plan](dev-log/2026-06-08-frontend-dev-plan.md) · [chatinput-welcome](dev-log/2026-07-03-chatinput-welcome-redesign.md) · [markdown-mermaid](dev-log/2026-07-01-markdown-mermaid-implementation.md) · [ssr-state-hydration](dev-log/2026-06-29-ssr-state-hydration.md) |
| **性能与构建** | [perf-neon-latency](dev-log/2026-06-16-perf-neon-latency.md) · [cloudflare-worker-build-oom](dev-log/2026-07-05-cloudflare-worker-build-oom.md) |
| **设计规范** | [ADR-011](decisions/011-design-specification.md) |
| **工程化** | [ADR-010](decisions/010-eslint-over-prettier.md) · [code-standards-setup](dev-log/2026-06-02-code-standards-setup.md) · [cicd-setup](dev-log/2026-06-02-cicd-setup.md) |
| **Agent 开发** | [方案设计](../.claude/plan/phase2-agent-design.md) · [ADR-012](decisions/012-llm-stream-chunk-type.md) · [ADR-013](decisions/013-prompt-naming.md) · [ADR-014](decisions/014-agent-streaming-db-write.md) · [prompt-engineering](dev-log/2026-07-09-prompt-engineering-and-phase2-planning.md) |
| **部署运维** | [ADR-004](decisions/004-cloudflare-pages.md) · [cloudflare-worker-build-oom](dev-log/2026-07-05-cloudflare-worker-build-oom.md) |
