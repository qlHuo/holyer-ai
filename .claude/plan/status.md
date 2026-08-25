# 项目进度快照

> 更新于 2026-08-19

## 当前状态

**Phase 2 完成 ✅** — 工具系统 + Agent Runtime + 可观测性 + 全链路审查已收尾。Phase 3 顺序待定（MCP vs RAG）。

## 近期完成

- Phase 2 审查 — 8 层链路梳理 + 7 项修复（2026-08-18）
- Prompt 调优闭环 — 80%→100%（2026-08-18）
- AbortSignal 传递至工具执行层（2026-08-17）

## 下一步（顺序待决策，见下）

1. **[共同前置] PromptSegment 抽象** — RAG/MCP 都会注入 prompt 片段，先落地 `server/service/prompt/`
2. **[推荐] RAG 知识库** — 检索做成内置工具，复用 ToolRegistry，个人知识库场景价值最直接
3. **[备选] MCP 客户端** — 工具系统外部化，学习 Agent 生态协议，但当前无明确外部 server 需求

## 阻塞 / 风险

- Phase 3 顺序未定（MCP 先 vs RAG 先）— 详见本次 /progress 决策分析

## 推迟项

todo.md 中有 9 项待办，详见 [todo.md](todo.md)
