# 技术调研

> 关联文档：[需求分析](requirements.md) · [架构设计](architecture.md) · [实施路线图](roadmap.md)

---

## 1. Nuxt 4 + TypeScript 全栈方案可行性

**结论：完全可行，推荐作为唯一技术栈。**

### 1.1 Nuxt 4 现状

| 项目 | 状态 |
|------|------|
| 最新稳定版 | **v4.4**（2026-03-12） |
| 正式发布时间 | 2025-07-15 |
| 生产就绪 | ✅ 是 |

Nuxt 4 核心改进：新的 `app/` 目录结构、更好的 TypeScript 支持、更快的 CLI。

### 1.2 Nitro 服务端能力评估

Nitro（Nuxt 4 内置服务端框架）能支撑完整 AI Agent 后端：

| 能力 | 评估 | 说明 |
|------|------|------|
| SSE 流式传输 | ⚠️ 可行但需注意 | `sendStream()` 原生支持，需心跳机制应对 Cloudflare 100s 空闲超时 |
| 长时间请求 | ✅ 可行 | 取决于部署平台限制，AI 调用主要是 I/O 等待不消耗 CPU |
| 中间件/路由 | ✅ 完善 | 文件系统路由 + 全局中间件，类型安全 |
| 业务逻辑组织 | ✅ 可行 | 推荐 `server/services/` 分层 + `server/utils/` 工具函数模式 |

### 1.3 与 NestJS / Python 对比

| 维度 | Nuxt 4 全栈 | NestJS 纯后端 | Python (FastAPI) |
|------|-------------|--------------|------------------|
| 前后端统一 | ✅ 单一语言/项目 | ❌ 需另建前端 | ❌ 需另建前端 |
| AI 生态深度 | ⚠️ LangChain.js 可用 | ⚠️ 同 TypeScript | ✅ LangChain/LlamaIndex |
| 本地模型推理 | ❌ 不支持 | ❌ 不支持 | ✅ PyTorch/TensorFlow |
| 适合场景 | 调用外部 AI API | 企业级复杂后端 | 深度 AI 编排 |
| 学习成本 | 低-中（Vue 开发者友好） | 中-高 | 中 |
| 部署多样性 | 20+ 平台一键适配 | 需手动配置 | 手动配置 |

**决策：本项目 AI 调用均为外部 API（OpenAI / Anthropic / DeepSeek），不涉及本地模型推理或 LangChain 复杂编排，Nuxt 4 全栈方案是最优解，无需引入额外后端语言。**

### 1.4 已知风险

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| `unjs/httpxy` SSE 连接关闭通知 Bug | 低 | 客户端重连逻辑 |
| Cloudflare 100s 空闲超时断连 SSE | 中 | **每 30s 发送心跳包**（`event: ping`） |
| Nuxt 4 路径别名变更 (`~` → `app/`) | 低 | 使用最新版依赖 |
| 第三方依赖可能依赖 Node.js API | 中 | 审核依赖，优先使用边缘兼容包 |

---

## 2. UI 组件库选型

**结论：选择 Nuxt UI v4（5/5 星推荐）。**

### 2.1 方案对比

| 维度 | TDesign | shadcn-vue | **Nuxt UI v4** |
|------|:---:|:---:|:---:|
| Nuxt 4 兼容性 | ⚠️ 非原生，需手动适配 | ✅ 基本支持 | ✅ **官方出品，原生集成** |
| AI Chat 组件 | ⚠️ alpha 版本，有已知问题 | ❌ 无，需自建（2-4周） | ✅ **生产级全套 Chat 组件** |
| 暗黑模式 | ✅ 完善 | ✅ 完善 | ✅ **语义化颜色系统** |
| 组件数量 | 50+ | 按需引入 | **125+（全部免费）** |
| 包体积 | 大 | 小 | 中 |
| 社区活跃度 | 中（腾讯维护） | 活跃（~10k stars） | **非常活跃（官方维护）** |
| 开发效率 | 中 | 中 | **高** |

### 2.2 为什么不用 TDesign

1. **非 Nuxt 原生**：无 Nuxt 模块注册方式，需手动插件注册
2. **SSR 兼容性历史问题**：虽 Issue #3458（Form/Select 的 `isError` 冲突）已关闭，但跨越 30 个版本无 regression test，仍存风险
3. **Chat 组件为 alpha 版本**（0.3.0），有生产构建样式丢失反馈
4. TDesign 设计语言偏中后台（表格、表单），不适合 AI Chat 场景

### 2.3 Nuxt UI v4 核心优势

- **完整 AI Chat 组件套件**：ChatMessages、ChatMessage、ChatPrompt、ChatReasoning、ChatTool、ChatShimmer 等
- **官方 Chat 模板**：`npx nuxi init -t gh:nuxt-ui/chat` 直接拉取含认证 + 历史持久化的模板
- **底层 Reka UI**：无障碍性优秀
- **完全免费开源**：原 Pro 组件（125+）已全部开源
- **Vercel AI SDK v5 原生集成**：`useChat` composable 开箱即用

---

## 3. 数据库方案

**结论：选择 Neon（Serverless PostgreSQL）+ Drizzle ORM。**

### 3.1 方案对比

| 维度 | **Neon** | Supabase | Cloudflare D1 + Vectorize |
|------|:---:|:---:|:---:|
| 数据库类型 | PostgreSQL | PostgreSQL | SQLite |
| 向量搜索 | ✅ pgvector | ✅ pgvector | ✅ Vectorize |
| 免费额度 | 0.5GB 存储 | 500MB DB + 2GB 存储 | 5GB DB + 100万向量 |
| 付费起价 | ~$19/月 | ~$25/月 | 按量付费 |
| Cloudflare 兼容 | ✅ HTTP 驱动 | ⚠️ 需 HTTP 连接 | ✅ 原生 |
| ORM 支持 | ✅ Drizzle (neon-http) | ✅ Drizzle (postgres) | ✅ Drizzle (d1) |
| 生态成熟度 | ✅ 成熟 PG 生态 | ✅ 成熟 PG 生态 | ⚠️ Vectorize 较新 |
| 供应商锁定 | **低**（标准 PG） | 低（标准 PG） | 高（Cloudflare 专有） |
| 上手难度 | 中（需学 SQL + ORM） | 中低（有图形界面） | 低（Cloudflare 集成） |

### 3.2 选择 Neon 的理由

1. **标准 PostgreSQL**：不锁定供应商，未来可迁移到 Supabase、自建 PG 等
2. **HTTP 驱动直连**：`@neondatabase/serverless` + `drizzle-orm/neon-http`，Cloudflare Workers 原生兼容
3. **pgvector 成熟稳定**：向量搜索经过大量生产验证
4. **免费层够起步**：0.5GB 对个人使用初期的对话记录 + 少量知识库文档足够
5. **上手难度可控**：Drizzle ORM 提供类型安全的查询 API，类似写 TypeScript，不需要手写原始 SQL

### 3.3 对前端开发者的建议

- 使用 **Drizzle ORM** 而非手写 SQL：类型安全、自动补全、迁移管理
- 初期只需理解 3 个核心概念：表（Table）、查询（Select/Insert/Delete）、关联（Relation）
- Drizzle 的 API 设计类似 TypeScript 数组操作，前端开发者容易上手
- Neon 提供 Web 控制台，可图形化查看数据

---

## 4. Cloudflare 部署方案

**结论：可行，需付费计划 + 心跳机制，无需额外部署服务。**

### 4.1 部署架构

```
用户浏览器
    │
    ▼
Cloudflare Pages (Nuxt 4 SSR + API Routes)
    │
    ├──► Cloudflare Worker (Nitro API)
    │       │
    │       ├──► OpenAI / Anthropic / DeepSeek API (外部)
    │       ├──► Neon PostgreSQL (HTTP 连接)
    │       └──► SSE 流式响应 → 用户浏览器
    │
    └──► 静态资源 (CDN 边缘缓存)
```

### 4.2 成本估算

| 资源 | 免费层 | 付费层 | 预估月费 |
|------|--------|--------|---------|
| Cloudflare Workers | 10万请求/天 | $0.30/百万请求 | ~$5 |
| Cloudflare Pages | 500次构建/月 | 超出按量 | $0 |
| Neon PostgreSQL | 0.5GB 存储 | 1GB ~$19 | $0 初期 |
| **总计** | | | **~$5/月** |

### 4.3 关键技术细节

| 事项 | 说明 |
|------|------|
| **SSE 心跳** | 每 30s 发送 `event: ping`，防止 Cloudflare 100s 空闲超时断开连接 |
| **CPU 时间** | Workers 付费计划默认 30s CPU，可配置至 5 分钟。AI 请求主要是 I/O 等待，不消耗大量 CPU |
| **压缩禁用** | SSE 端点需禁用 Cloudflare 自动压缩（Brotli/Gzip 会缓冲数据破坏实时流） |
| **部署命令** | `npx nuxi build`（配置 `nitro.preset: 'cloudflare-pages'`） |
| **数据库连接** | Neon 连接池化 URL（含 `-pooler.`），HTTP 驱动不需要 TCP |

### 4.4 不需要额外服务的理由

本项目的 AI 调用全部为外部 API 代理（OpenAI / Anthropic / DeepSeek），不涉及：
- 本地模型推理（无需 GPU 节点）
- LangChain 复杂编排（无需 Python 后端）
- 文件系统访问（使用 R2 对象存储替代）
- 超长 CPU 密集型计算
