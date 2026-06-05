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
| 1.5 | Chat UI | Nuxt UI v4 Chat 组件集成 | ⬜ |
| 1.6 | 对话持久化 | CRUD API + /api/chat 记忆注入 + SSE 增强（详见[设计文档](../../docs/dev-log/2026-06-03-conversation-persistence-design.md)） | ⬜ |
| 1.7 | 暗黑模式 | 跟随系统 + 手动切换 | ⬜ |

**交付物**：可运行的多模型聊天应用，支持流式输出、对话历史、暗黑模式。

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
