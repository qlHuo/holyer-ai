# ADR-007: .claude/rules/ 按技术域分层

> 日期：2026-05-31 · 状态：✅ 已采纳

---

## 背景

需要为 Claude Code 配置按路径作用域加载的规则文件，确保 Claude 在不同技术域（前端、数据库、Edge Runtime、SSE）工作时自动获取对应约束。

## 决策

**4 个 rules 文件按技术域划分，通过 YAML frontmatter `paths:` 实现路径门控。**

## 最终结构

```
.claude/rules/
├── frontend.md       # paths: app/**
├── database.md       # paths: server/db/**, server/api/**
├── edge-runtime.md   # paths: server/**, nuxt.config.ts
└── sse.md            # paths: server/api/chat/**, server/utils/sse.ts
```

## 关键理由

1. **按路径触发**：Claude 编辑 `app/` 文件时加载 frontend.md，编辑 `server/db/` 时加载 database.md，避免无关规则占上下文
2. **按域分层而非按文件**：一个规则覆盖一个技术域的所有工作（如 frontend.md 覆盖 UI 组件、composable、样式等）
3. **内容聚焦"容易踩的坑"**：每个规则只写关键陷阱和强制约束，不重复架构文档已有的内容

## 各文件核心约束

| 规则文件 | 核心内容 |
|----------|---------|
| `frontend.md` | Tailwind v4 CSS 驱动配置、Nuxt UI v4 组件 API、composable 模式 |
| `database.md` | 必须从 `server/db/index.ts` 导入 db、Drizzle neon-http 驱动限制 |
| `edge-runtime.md` | 禁止 Node.js API、依赖 Edge 兼容性审核、openai/anthropic SDK 版本 |
| `sse.md` | 30s 心跳必须、Cloudflare 100s 空闲超时、压缩禁用 |

## 代价

- 规则文件多了维护负担（4 个文件），但每文件短小（~30 行），实际成本低
- 需要确保 `paths:` pattern 覆盖到位
