# 文档索引

> 60 篇项目文档的中心索引。新增文档后更新此文件（也可通过 `/doc-consolidate` 自动维护）。

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
| ADR-009 | [009-model-compatibility](decisions/009-model-compatibility.md) | 国内模型 API 兼容性调研与统一策略（2026-07-26 更新：双适配器→单适配器演进） |
| ADR-010 | [010-eslint-over-prettier](decisions/010-eslint-over-prettier.md) | ESLint stylistic rules 替代 Prettier |
| ADR-011 | [011-design-specification](decisions/011-design-specification.md) | 设计规范体系（配色/字体/间距/圆角/阴影/动效） |
| ADR-012 | [012-llm-stream-chunk-type](decisions/012-llm-stream-chunk-type.md) | `chat()` 返回类型升级为 `ReadableStream<LLMStreamChunk>` |
| ADR-013 | [013-prompt-naming](decisions/013-prompt-naming.md) | 统一命名为 Prompt（自定义提示词模板），Phase 2 第一步实现 |
| ADR-014 | [014-agent-streaming-db-write](decisions/014-agent-streaming-db-write.md) | Agent 流式 DB 写入策略（一次性写入，已知让步） |

---

## 开发日志（34 篇）

`docs/dev-log/` — 深层讨论、核心概念澄清、设计推演、Bug 排查。

### 2026-08

| 日期 | 文件 | 内容 |
|------|------|------|
| 08-26 | [rag-image-display-boundary](dev-log/2026-08-26-rag-image-display-boundary.md) | **知识库图片展示：为什么通用平台做不到** — 检索侧/呈现侧拆分、千问 DS Dify 四层原因、语料所有权规律、三层边界设计、既有图片渲染安全缺口 |
| 08-18 | [phase2-review](dev-log/2026-08-18-phase2-review.md) | **Phase 2 全链路审查与收尾修复** — 8 层链路梳理、7 项问题分级、修复死代码/SSRF/error 落库等 7 项、后台切回残留推迟 |
| 08-19 | [rag-knowledge-base-design](dev-log/2026-08-19-rag-knowledge-base-design.md) | **RAG 知识库功能完整设计方案** — 概念澄清（三层模型/两阶段数据流/Agentic RAG）、业界演进、语义分块/混合检索/Contextual Retrieval 四决策、Schema、三阶段实施 |
| 08-17 | [prompt-eval-tuning-loop](dev-log/2026-08-17-prompt-eval-tuning-loop.md) | **Prompt 评测-调优闭环实践** — 5 层 prompt 分布盘点、6 条工具描述审计、评测脚本落地、80%→100% 调优、评测鸡肋与规范反思 |
| 08-06 | [agent-content-filter-self-healing](dev-log/2026-08-06-agent-content-filter-self-healing.md) | **Agent 内容审核拦截的自愈方案** — 并行试毒、精确剔除、渐进降级、Provider 复用模式、退化版子 Agent |
| 08-06 | [agent-react-known-issues](dev-log/2026-08-06-agent-react-known-issues.md) | **Agent ReAct 已知问题记录** — 文本闪烁根因与前瞻窗口方案、工具结果未持久化、AbortSignal 未传递等 5 项问题 |
| 08-05 | [agent-react-full-flow](dev-log/2026-08-05-agent-react-full-flow.md) | **Agent ReAct + 工具调用完整流程分析** — 6 层架构逐层追踪、Runner 核心循环、流式分轮策略、SSE 事件映射 |
| 08-04 | [web-search-backend-selection](dev-log/2026-08-04-web-search-backend-selection.md) | **网络搜索工具后端选型** — Brave → DDG → SearXNG → Tavily 四次尝试、keyless 模式、日期感知修复 |

### 2026-07

| 日期 | 文件 | 内容 |
|------|------|------|
| 07-29 | [agent-tool-system-implementation](dev-log/2026-07-29-agent-tool-system-implementation.md) | **Agent 工具系统实现详解** — 完整链路、JSON Schema 参数设计、常见疑点速查、前端定义迁移 |
| 07-28 | [agent-tool-system-p0-analysis](dev-log/2026-07-28-agent-tool-system-p0-analysis.md) | **Agent 工具调用系统 P0 分析与方案** — 当前缺口、立即修复方案、文件变更清单 |
| 07-26 | [provider-simplification](dev-log/2026-07-26-provider-simplification.md) | **Provider 维度移除全栈实施** — 双适配器→单适配器、21 文件净删 259 行、provider 全链路移除 |
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

## 学习笔记（8 篇）

`docs/learning-notes/` — 新技术知识点梳理。

| 文件 | 内容 |
|------|------|
| [nuxt4-notes](learning-notes/nuxt4-notes.md) | Nuxt 4 学习笔记 |
| [cloudflare-edge-notes](learning-notes/cloudflare-edge-notes.md) | Cloudflare Workers Edge Runtime 限制与应对 |
| [web-streams-api](learning-notes/web-streams-api.md) | **Web Streams API 详解** — ReadableStream、TextEncoder、Response |
| [drizzle-kit](learning-notes/drizzle-kit.md) | **Drizzle Kit CLI 工具笔记** — 配置、push/generate/migrate/studio 命令、本地/生产工作流 |
| [drizzle-orm](learning-notes/drizzle-orm.md) | **Drizzle ORM API 笔记** — Schema 定义、CRUD 操作、`.returning()`、双驱动、分层架构（以 prompts 为例） |
| [zod](learning-notes/zod.md) | **Zod 校验库笔记** — Schema 定义、`.parse()` vs `.safeParse()`、全局错误处理、三种数据来源校验 |
| [prompt-engineering-standards](learning-notes/prompt-engineering-standards.md) | **业界提示词工程规范** — 模板框架（CO-STAR/CRISPE/五要素/ICIO）、方法论、工程化规范 + 适用边界 |
| [pgvector](learning-notes/pgvector.md) | **pgvector 笔记** — 向量列 vs 标量列（各家术语对照）、向量与元数据「同一行」关联原理、距离运算符、索引换速度损召回、维度不可逆 |

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
| **LLM Provider 层** | [ADR-008](decisions/008-vercel-ai-sdk.md) · [ADR-009](decisions/009-model-compatibility.md) · [provider-implementation](dev-log/2026-06-01-provider-implementation.md) · [type-safety-review](dev-log/2026-06-02-type-safety-review.md) · [provider-review-round2](dev-log/2026-06-02-provider-review-round2.md) · [provider-simplification](dev-log/2026-07-26-provider-simplification.md) |
| **SSE 流式架构** | [streaming-architecture](dev-log/2026-05-31-streaming-architecture.md) · [sse-implementation](dev-log/2026-06-03-sse-implementation.md) · [stream-leakage-root-cause](dev-log/2026-06-25-stream-leakage-root-cause.md) · [stream-interruption-protection](dev-log/2026-06-23-stream-interruption-protection.md) · [stream-architecture-v2](dev-log/2026-06-27-stream-architecture-v2.md) |
| **对话持久化** | [conversation-persistence-design](dev-log/2026-06-03-conversation-persistence-design.md) · [code-review-conversation](dev-log/2026-06-05-code-review-conversation.md) · [regenerate-design](dev-log/2026-06-22-regenerate-design.md) |
| **前端架构** | [frontend-dev-plan](dev-log/2026-06-08-frontend-dev-plan.md) · [chatinput-welcome](dev-log/2026-07-03-chatinput-welcome-redesign.md) · [markdown-mermaid](dev-log/2026-07-01-markdown-mermaid-implementation.md) · [ssr-state-hydration](dev-log/2026-06-29-ssr-state-hydration.md) |
| **性能与构建** | [perf-neon-latency](dev-log/2026-06-16-perf-neon-latency.md) · [cloudflare-worker-build-oom](dev-log/2026-07-05-cloudflare-worker-build-oom.md) |
| **数据库** | [ADR-003](decisions/003-neon-drizzle.md) · [drizzle-kit](learning-notes/drizzle-kit.md) · [drizzle-orm](learning-notes/drizzle-orm.md) · [database-rules](../.claude/rules/database.md) |
| **设计规范** | [ADR-011](decisions/011-design-specification.md) |
| **工程化** | [ADR-010](decisions/010-eslint-over-prettier.md) · [code-standards-setup](dev-log/2026-06-02-code-standards-setup.md) · [cicd-setup](dev-log/2026-06-02-cicd-setup.md) · [zod](learning-notes/zod.md) |
| **Agent 开发** | [方案设计](../.claude/plan/phase2-agent-design.md) · [ADR-012](decisions/012-llm-stream-chunk-type.md) · [ADR-013](decisions/013-prompt-naming.md) · [ADR-014](decisions/014-agent-streaming-db-write.md) · [P0 分析](dev-log/2026-07-28-agent-tool-system-p0-analysis.md) · [实现详解](dev-log/2026-07-29-agent-tool-system-implementation.md) · [完整流程](dev-log/2026-08-05-agent-react-full-flow.md) · [已知问题](dev-log/2026-08-06-agent-react-known-issues.md) · [搜索后端选型](dev-log/2026-08-04-web-search-backend-selection.md) · [内容审核自愈](dev-log/2026-08-06-agent-content-filter-self-healing.md) · [prompt-engineering](dev-log/2026-07-09-prompt-engineering-and-phase2-planning.md) · [评测调优](dev-log/2026-08-17-prompt-eval-tuning-loop.md) · [业界规范](learning-notes/prompt-engineering-standards.md) |
| **RAG 知识库** | [完整设计](dev-log/2026-08-19-rag-knowledge-base-design.md) · [图片展示边界](dev-log/2026-08-26-rag-image-display-boundary.md) · [pgvector](learning-notes/pgvector.md) · [ADR-003](decisions/003-neon-drizzle.md) |
| **部署运维** | [ADR-004](decisions/004-cloudflare-pages.md) · [cloudflare-worker-build-oom](dev-log/2026-07-05-cloudflare-worker-build-oom.md) |
