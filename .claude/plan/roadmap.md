# 实施路线图

> 关联文档：[架构设计](architecture.md) · [需求分析](requirements.md) · [扩展性设计](extensibility.md) · [ADR-008 Vercel AI SDK](../../docs/decisions/008-vercel-ai-sdk.md) · [ADR-009 模型兼容性](../../docs/decisions/009-model-compatibility.md) · [流式架构讨论](../../docs/dev-log/2026-05-31-streaming-architecture.md)

---

> 状态说明：⬜ 待开始 · 🔄 进行中 · ✅ 已完成 · ⏸️ 推迟（已废弃，改用 [todo.md](todo.md)）

## Phase 1：核心基础（预计 3-4 天）✅ 已完成（2026-06 中旬）

| 编号 | 任务 | 内容 | 状态 |
|------|------|------|:--:|
| 1.1 | 项目初始化 | Nuxt 4 + Nuxt UI v4 + Drizzle ORM（Wrangler 部署时再配） | ✅ |
| 1.2 | LLM Provider 层 | types → factory → openai / anthropic / deepseek（详见 ADR-008、ADR-009） | ✅ |
| 1.3 | SSE 工具 | 带心跳的流式响应工具函数（详见流式架构讨论） | ✅ |
| 1.4 | `/api/chat` 端点 | 多模型流式对话 API | ✅ |
| 1.5 | Chat UI | Nuxt UI v4 Chat 组件集成 + 对话管理界面（详见[前端开发方案](../../docs/dev-log/2026-06-08-frontend-dev-plan.md)） | ✅ |
| 1.6 | 对话持久化 | CRUD API + /api/chat 记忆注入 + SSE 增强（详见[设计文档](../../docs/dev-log/2026-06-03-conversation-persistence-design.md)） | ✅ |
| 1.7 | 暗黑模式 | 跟随系统 + 手动切换 | ✅ |

**交付物**：可运行的多模型聊天应用，支持流式输出、对话历史、暗黑模式。

---

## Phase 1.5：Phase 1 完善（预计 5-7 天）✅ 已完成（2026-07-05）

> 关联：[Phase 1 审查报告](../../docs/dev-log/2026-06-18-phase1-review.md)

Phase 1 核心功能完整但存在系统性差距——设计规范、错误反馈、API 抽象层、公共方法封装等横切关注点缺失。本阶段在进入 Phase 2 之前补齐这些基础。

### 第一轮：工程基础 + 架构重构（P0）

| 编号 | 任务 | 内容 | 状态 |
|------|------|------|:--:|
| 1.8 | 死代码清理 | 删除 settings.store.ts（重写）、test.get.ts、修正 package.json/app.vue 文本 | ✅ |
| 1.9 | 后端参数验证 | 引入 zod，所有 API 端点类型安全校验 | ✅ |
| 1.10 | 后端错误中间件 | 全局捕获异常，统一返回 JSON（非 HTML） | ✅ |
| 1.11 | 后端响应格式统一 | 全部 REST 接口统一为 `{ success, data, error }` 包装 | ✅ |
| 1.12 | 后端公共抽取 | system-prompt 函数抽取 + SSE 事件类型枚举化 | ✅ |
| 1.13 | 前端 API 层 | `app/api/` 统一封装 $fetch，类型自动推断 | ✅ |
| 1.14 | ~~Store 拆分~~ | conversation / message / settings 三 Store — **不做**（197 行规模合理，协调成本 > 组织收益，详见审查文档 11.2 节） | ❌ |
| 1.15 | 前端公共抽取 | SSE 事件枚举化（✅）、extractSSEField（✅）、~~formatTime/clipboard~~（❌ 不做） | ✅ |

### 第二轮：交互兜底 + 功能补全（P0/P1）

| 编号 | 任务 | 内容 | 状态 |
|------|------|------|:--:|
| 1.16 | 错误反馈体系 | Toast 补齐 + 消息气泡错误态（变红+重试按钮）+ 空状态错误变体（加载失败→重试）。~~ErrorBanner~~（简化：仅 ChatPanel 顶部网络状态条，不做独立全局组件） | ✅ |
| 1.18 | ChatInput 优化 | textarea 双区域重构 → 统一卡片方案（textarea + 工具栏共用一个边框 + `focus-within` 焦点环），粘贴处理（超长截断、图片提示），`nextTick` 高度还原。~~contenteditable~~ 否决（详见 [设计文档](../../docs/dev-log/2026-07-03-chatinput-welcome-redesign.md)） | ✅ |
| 1.19 | 消息操作按钮 | 复制纯文本、重新生成。~~编辑重发~~ 已迁移至 [todo.md](todo.md) | ✅ |
| 1.20 | 代码高亮主题 | highlight.js CSS 引入（亮暗双模式） | ✅ |
| 1.21 | 侧边栏完善 | 防重复创建（✅）、骨架屏（✅）、搜索（✅）、折叠（✅） | ✅ |
| 1.22 | ~~前端动态模型列表~~ | `/api/models` 接口替代 providers.ts 硬编码 — **不做**（7 个模型不需要动态化，推迟到 Phase 2 Agent 按 skill 推荐模型时再做） | ❌ |
| 1.28 | 流式增量写入 DB | 后端 /api/chat 在 LLM 流开始前 INSERT 空占位 → 每 200 字符 UPDATE content → 流结束最终 UPDATE。解决用户刷新/切走页面时内容全部丢失的痛点（详见 [流式中断保护方案](../../docs/dev-log/2026-06-23-stream-interruption-protection.md) · [根因分析](../../docs/dev-log/2026-06-25-stream-leakage-root-cause.md)） | ✅ |
| 1.29 | 切换对话自动 abort | useChat watch currentConvId → 变更时 abort 旧请求 + Store 层 `streamingConvId` 校验兜底。解决流式输出中切换对话，旧内容泄漏到新对话的竞态 bug（详见 [流式中断保护方案](../../docs/dev-log/2026-06-23-stream-interruption-protection.md) · [根因分析](../../docs/dev-log/2026-06-25-stream-leakage-root-cause.md)） | ✅ |
| 1.30 | 后台流保持 + 切回续显 | **已与 1.28/1.29 合并为完整的 V2 架构升级**：模块级 `streamSessions` Map + `sendingConvIds` Set、`switchConversation` 切换入口、`restoreStreamSession` 恢复实时输出、服务端 `AbortSignal` 完整取消链（详见 [流式架构 V2](../../docs/dev-log/2026-06-27-stream-architecture-v2.md)） | ✅ |

### 第三轮：体验打磨 + 工程化（P1/P2）

| 编号 | 任务 | 内容 | 状态 |
|------|------|------|:--:|
| 1.23 | 设计规范体系 | 配色/字体/间距/圆角/阴影/动效/滚动条定制 — token 层 + 组件改造（详见 [ADR-011](../../docs/decisions/011-design-specification.md)） | ✅ |
| 1.24 | 页面初始化 | 欢迎页快速操作增强 — 6 个静态提示词卡片（桌面 3 列/移动 2 列），点击填入输入框。复用现有 ChatPanel 欢迎区，不创建独立页面（详见 [设计文档](../../docs/dev-log/2026-07-03-chatinput-welcome-redesign.md)） | ✅ |
| 1.26 | Mermaid 渲染 | markdown-it fence 识别 mermaid 语言，流式结束后客户端渲染 SVG（详见 [实现文档](../../docs/dev-log/2026-07-01-markdown-mermaid-implementation.md)） | ✅ |
| 1.27 | TS strict | TypeScript strict:true + noUncheckedIndexedAccess 等（Nuxt 4 默认开启，当前 typecheck 零错误） | ✅ |

> **明确不做/推迟**：以下审查文档中提出的改造项经讨论确认不在 Phase 1.5 范围内或推迟到后续 Phase：
> - ❌ Store 拆分（1.14）— 当前 197 行规模合理，协调成本大于组织收益
> - ❌ ErrorBanner 全局横幅 — 简化为 ChatPanel 内联网络状态条，不单独抽组件
> - ❌ `/api/models` 动态模型列表（1.22）— 7 个模型不需要动态化，推迟到 Phase 2
> - ❌ Provider 注册表模式 — 3 个 Provider 用 switch-case 足够，推迟到 ≥6 个时
> - ❌ `/api/v1/` 版本前缀 — 过度未来-proofing，无实际收益
> - ❌ 后端日志中间件 — 个人应用 console.log 足够
> - ✅ 后台流保持（1.30）— 已与 1.28/1.29 合并为流式架构 V2 完整升级，包含模块级单例、多路并行、切回恢复、服务端 AbortSignal 取消链（详见 [流式架构 V2](../../docs/dev-log/2026-06-27-stream-architecture-v2.md)）
> - 📋 SSE 重连（原 1.17）、编辑重发（原 1.19）、键盘快捷键（原 1.25）、API 单元测试（原 1.31）— 已迁移至 [todo.md](todo.md)

**交付物**：体验完整、架构规范、可直接承接 Phase 2 开发的稳定基础。

---

## Phase 2：自定义提示词管理 + Agent Runtime（预计 4-6 天）🔄 设计完成，实现待启动

> 方案：[Phase 2 Agent 系统设计方案](phase2-agent-design.md)（含 6 个架构决策 + 10 个实现步骤） · [ADR-012 LLMStreamChunk](../../docs/decisions/012-llm-stream-chunk-type.md) · [ADR-013 Prompt 命名](../../docs/decisions/013-prompt-naming.md) · [ADR-014 Agent 流式 DB 写入](../../docs/decisions/014-agent-streaming-db-write.md) · [提示词工程讨论](../../docs/dev-log/2026-07-09-prompt-engineering-and-phase2-planning.md)
>
> **Phase 2 分两步走**：第一步先做自定义提示词管理（Prompt CRUD，独立交付，让用户通过提示词创建"简易 Agent"），第二步再做 Agent Runtime + 核心工具（让 Agent 真正能干事情）。Provider 层精简（删除 Anthropic、DeepSeek 复用 OpenAIProvider）是时间从 5-7 天缩短到 4-6 天的主要原因。

### 第一步：自定义提示词管理（简易 Agent）

| 编号 | 任务 | 内容 | 状态 |
|------|------|------|:--:|
| 2.0 | 自定义提示词管理 | DB Schema + CRUD Service + 5 个 REST API + 对话级 Prompt 选择 | ⬜ |

> 用户创建的自定义提示词 = "简易 Agent"（OpenAI Custom GPTs 机制）。无需 ReAct 循环即可体验 Agent 行为定制。此步骤零依赖（DB + API 模式已在 Phase 1 就绪），可立即独立交付。详见 [ADR-013](../../docs/decisions/013-prompt-naming.md)。

### 第二步：Agent Runtime + 核心工具

| 编号 | 任务 | 内容 | 状态 |
|------|------|------|:--:|
| 2.1 | Agent Runtime | ReAct 循环 + 上下文管理 + Prompt Segment 系统 | ⬜ |
| 2.2 | 内置工具 | 计算器、时间、搜索、网页抓取等 | ⬜ |
| 2.3 | Provider 升级 + 精简 | chat() → `ReadableStream<LLMStreamChunk>`、tool call delta 累积、删除 Anthropic、DeepSeek 复用 OpenAIProvider | ⬜ |
| 2.4 | Agent API | `/api/agent/run` 端点 + Prompt 注入管线 | ⬜ |
| 2.5 | Agent UI | 工具调用可视化（ToolCallCard）、推理过程展示 | ⬜ |
| 2.6 | Agent 可观测性 | 工具调用日志 + ReAct 循环追踪 + Token 消耗统计 | ⬜ |
| 2.7 | 安全护栏 | 工具权限分级（只读/读写/危险）+ 敏感操作二次确认 | ⬜ |

> **Prompt + Agent 协同**：第二步 Agent Runtime 完工后，第一步创建的所有 Prompt 自动获得工具调用能力。LLM 看到 Prompt 提示词 + 工具列表，自然按提示词引导调用工具。Prompt 的能力上限由平台可用工具决定。

---

## 横切关注点（随 Phase 推进持续迭代）

> 这些不是独立 Phase 任务，而是贯穿 Phase 2–4 的开发实践。详见[提示词工程讨论](../../docs/dev-log/2026-07-09-prompt-engineering-and-phase2-planning.md)。

| 编号 | 关注点 | 内容 | 介入时机 |
|------|--------|------|---------|
| X1 | 提示词工程 | ReAct 指令模板、工具描述调优、`PromptSegment` 抽象层（`server/service/prompt/`）、上下文预算管理、评估集驱动迭代 | Phase 2–4 |
| X2 | 可观测性 | 工具调用日志、ReAct 循环追踪、Token 消耗统计 | Phase 2–3 |
| X3 | 安全护栏 | 工具权限分级（只读/读写/危险）、危险操作确认、输出过滤 | Phase 2 |
| X4 | 行为评估 | Agent 用例测试集、工具调用正确性验证 | Phase 2–4 |

---

## Phase 3：MCP + 垂直场景框架（预计 2-3 天）

| 编号 | 任务 | 内容 | 状态 |
|------|------|------|:--:|
| 3.1 | MCP Client | HTTP/SSE 传输 | ⬜ |
| 3.2 | MCP 管理界面 | 连接/断开服务器、工具列表 | ⬜ |
| 3.3 | 垂直场景框架 | 场景模板 + 快速创建机制 | ⬜ |
| 3.4 | 示例场景 | 代码审查助手 | ⬜ |

---

## Phase 4：RAG（预计 2-3 天）

| 编号 | 任务 | 内容 | 状态 |
|------|------|------|:--:|
| 4.1 | 文档处理 | 上传、解析、分块管道 | ⬜ |
| 4.2 | 向量存储 | pgvector 表 + Embeddings | ⬜ |
| 4.3 | 检索 API | 相似度搜索 + 上下文注入 | ⬜ |
| 4.4 | 知识库 UI | 文档管理 + 搜索测试 | ⬜ |

---

## 关键风险矩阵

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Cloudflare 100s 空闲超时断流 | 中 | 高 | SSE 30s 心跳 + 客户端自动重连 |
| Neon 免费层不够用 | 中 | 中 | 监控用量，预留升级预算 |
| DeepSeek 工具调用不稳定 | 中 | 中 | 先基于 OpenAI/Anthropic 验证 |
| Nuxt 4 依赖兼容问题 | 低 | 中 | 锁定版本，定期更新 |
| 个人开发效率瓶颈 | 高 | 中 | Phase 拆分，每阶段有可用交付物 |

---

## 验证方案

```bash
# 1. 启动本地开发
npx nuxi dev

# 2. 测试多模型流式对话
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai","model":"gpt-4o","messages":[{"role":"user","content":"你好"}]}'

# 3. 构建 Cloudflare 版本
npx nuxi build

# 4. 本地模拟 Cloudflare 环境
npx wrangler pages dev dist/

# 5. 数据库迁移
npx drizzle-kit push

# 6. 端到端验证项
# - 切换模型（OpenAI → Claude → DeepSeek）对话正常
# - Agent 工具调用正确执行
# - RAG 文档检索返回相关内容
```
