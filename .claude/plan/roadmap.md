# 实施路线图

> 关联文档：[架构设计](architecture.md) · [需求分析](requirements.md) · [扩展性设计](extensibility.md) · [ADR-008 Vercel AI SDK](../../docs/decisions/008-vercel-ai-sdk.md) · [ADR-009 模型兼容性](../../docs/decisions/009-model-compatibility.md) · [流式架构讨论](../../docs/dev-log/2026-05-31-streaming-architecture.md)

---

> 状态说明：⬜ 待开始 · 🔄 进行中 · ✅ 已完成

## Phase 1：核心基础（预计 3-4 天）

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

## Phase 1.5：Phase 1 完善（预计 5-7 天）

> 关联：[Phase 1 审查报告](../../docs/dev-log/2026-06-18-phase1-review.md)

Phase 1 核心功能完整但存在系统性差距——设计规范、错误反馈、API 抽象层、公共方法封装等横切关注点缺失。本阶段在进入 Phase 2 之前补齐这些基础。

### 第一轮：工程基础 + 架构重构（P0）

| 编号 | 任务 | 内容 | 状态 |
|------|------|------|:--:|
| 1.8 | 死代码清理 | 删除 settings.store.ts（重写）、test.get.ts、修正 package.json/app.vue 文本 | ✅ |
| 1.9 | 后端参数验证 | 引入 zod，所有 API 端点类型安全校验 | ✅ |
| 1.10 | 后端错误中间件 | 全局捕获异常，统一返回 JSON（非 HTML） | ✅ |
| 1.11 | 后端响应格式统一 | 全部 REST 接口统一为 `{ success, data, error }` 包装 | ⬜ |
| 1.12 | 后端公共抽取 | system-prompt 函数（✅）、Provider 注册表模式、日志中间件 | 🔄 |
| 1.13 | 前端 API 层 | `app/api/` 统一封装 $fetch，类型自动推断 | ⬜ |
| 1.14 | Store 拆分 | conversation / message / settings 三 Store 各司其职 | ⬜ |
| 1.15 | 前端公共抽取 | SSE 事件枚举化（✅）、extractSSEField（✅）、formatTime/clipboard（⏸️ 推迟） | 🔄 |

### 第二轮：交互兜底 + 功能补全（P0/P1）

| 编号 | 任务 | 内容 | 状态 |
|------|------|------|:--:|
| 1.16 | 错误反馈体系 | Toast 补齐 + ErrorBanner + 消息错误态 + 空状态错误变体 + SSE 错误恢复 | ⬜ |
| 1.17 | SSE 重连 | 指数退避重连，断点续传 | ⬜ |
| 1.18 | ChatInput 重写 | contenteditable div 替代 textarea，粘贴处理 | ⬜ |
| 1.19 | 消息操作按钮 | 复制（纯文本/Markdown）、重新生成、编辑重发 | ⬜ |
| 1.20 | 代码高亮主题 | highlight.js CSS 引入（亮暗双模式） | ⬜ |
| 1.21 | 侧边栏完善 | 搜索、折叠、骨架屏、防重复创建、删除确认位置修正 | ⬜ |
| 1.22 | 前端动态模型列表 | `/api/models` 接口替代 providers.ts 硬编码 | ⬜ |

### 第三轮：体验打磨 + 工程化（P1/P2）

| 编号 | 任务 | 内容 | 状态 |
|------|------|------|:--:|
| 1.23 | 设计规范体系 | 配色/字体/间距/圆角/阴影/动效/滚动条定制 | ⬜ |
| 1.24 | 页面初始化 | 骨架屏 + 欢迎页优化（参考 DeepSeek 风格） | ⬜ |
| 1.25 | 键盘快捷键 | Ctrl+K/N/Enter、Esc、Ctrl+/ | ⬜ |
| 1.26 | Mermaid 渲染 | markdown-it fence 识别 mermaid 语言 | ⬜ |
| 1.27 | TS strict + 测试 | TypeScript strict:true、conversations API 测试 | ⬜ |

**交付物**：体验完整、架构规范、可直接承接 Phase 2 开发的稳定基础。

---

## Phase 2：Agent + Skills（预计 2-3 天）

| 编号 | 任务 | 内容 | 状态 |
|------|------|------|:--:|
| 2.1 | Agent Runtime | ReAct 循环 + 上下文管理 | ⬜ |
| 2.2 | 内置工具 | 搜索、计算器、时间等 | ⬜ |
| 2.3 | Agent API | `/api/agent/run` 端点 | ⬜ |
| 2.4 | Skills 系统 | Loader + Registry（开发期 skill：.claude/skills/） | ⬜ |
| 2.5 | Agent UI | 工具调用可视化、推理过程展示 | ⬜ |

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
