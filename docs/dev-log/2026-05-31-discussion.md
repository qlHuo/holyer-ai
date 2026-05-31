# 2026-05-31 — 技术讨论：LangChain.js 集成评估

---

## 讨论背景

评估是否应在项目中集成 LangChain.js，以及 Cloudflare 部署方案的约束。

## 核心结论

### LangChain.js — 不集成（当前阶段）

| 阶段 | 是否需要 | 理由 |
|------|:---:|------|
| Phase 1（流式对话） | ❌ | 就是 HTTP + SSE 解析，自定义 Provider ~150行搞定 |
| Phase 2（Agent 循环） | ⚠️ | 手写完 ReAct 后再评估，那时能理解 LangChain 解决什么问题 |
| Phase 3+（RAG 管道） | ✅ 可换 | LangChain 的 chunker/retriever 成熟度高，手写成本大 |

### 为什么先自己写再评估 LangChain

1. **Phase 1 太简单**：LLM API 调用 + SSE 流解析，不需要框架
2. **先造轮子才能理解好轮子**：手写完 ReAct 循环后，对 LangChain 的 `createReactAgent()` 不再是黑盒
3. **避免被抽象绑架**：核心模块（Provider、Skills、MCP）自己掌握；LangChain 只在它真擅长的领域（RAG、Memory）接入

### 推荐演进路径

```
Phase 1-2：自定义 Provider → 手写 ReAct → 体会上下文管理痛点
    │
Phase 3-4：模块级替换 → LangChain 接管 RAG + Memory → Provider 保留自写
    │
未来：混搭架构 → 自写核心 + LangChain 辅助模块，统一接口对接
```

---

## Cloudflare 部署方案澄清

### Cloudflare 产品谱系

| 产品 | 底层 | Node.js 支持 |
|------|------|:---:|
| Workers | V8 沙箱 | 🟡 `nodejs_compat` 标志（`fs`/`crypto`/`path` 等现已支持） |
| Pages | 静态 + Workers Functions | 🟡 同 Workers |
| Containers | 完整 Linux Docker 容器 | 🟢 100% |

### Workers `nodejs_compat` 进展（2026）

- 开启后 `fs`、`crypto`、`path`、`net`、`stream` 等现已**完整支持**
- `child_process` 仍为 stub，不能真生成子进程
- LangChain.js 核心（`@langchain/core` + `@langchain/openai`）大概率能跑
- 生态 LangChain 模块（文档 Loader、向量存储连接器）多数不行

### 部署方案对比

| 方案 | 月费 | Node.js | 成熟度 |
|------|------|:---:|:---:|
| Cloudflare Containers | ~$5/月 | ✅ 完整 | 新（2026 GA） |
| Railway | ~$5/月 | ✅ 完整 | 成熟 |
| Fly.io | ~$5/月 | ✅ 完整 | 成熟 |

如果未来需要完整 LangChain.js 生态，选择 Railway 或 Fly.io 比 Containers 更省心。

---

## Nuxt + LangChain 兼容性

- **Nuxt 本身不限制 LangChain.js**：Nuxt/Nitro 只是运行环境，LangChain.js 是纯服务端库
- **限制全在部署目标**：Node.js 服务器 → 100% 兼容；Workers → 核心可以，生态不全
- 如果要学 LangChain，推荐 Railway + `node-server` preset，最快跑通

---

## 记录更新

已同步更新：
- [CLAUDE.md](../../CLAUDE.md) — 新增 `@docs/` 引用
- [roadmap.md](../../.claude/plan/roadmap.md) — 任务 1.1 移除 Wrangler 配置（部署时再配）
- `docs/decisions/` — 现已 9 份 ADR（含 008 Vercel AI SDK、009 国内模型兼容性）
- [ADR-008: Vercel AI SDK 不集成](../decisions/008-vercel-ai-sdk.md) — 同样"先自建再评估"策略
- [流式架构深层讨论](./2026-05-31-streaming-architecture.md) — 四段流式模型
