# 项目进度快照

> 更新于 2026-09-01

## 当前状态

**Phase 3 = RAG 知识库** — 阶段 A 已完成 ✅（2026-08-31，12 问召回 92%，达标 >80%），已上线 Neon。进入 **阶段 B 产品化**。

## 近期完成

- 3.4 检索工具 + 质量验证 — `search_knowledge_base` 注册进 ToolRegistry，Agentic 闭环跑通（2026-08-31）
- 3.2 / 3.3 检索管道 Service + 灌库脚本 — chunker/embeddings/retriever 纯函数三层 + `ingest-docs.ts`（2026-08-31）
- 3.1 Schema + pgvector — Docker 迁移 + Neon 启用 pgvector，三表 + 四预留列（2026-08-30）
- subrequest 超限修复 — 增量写入阈值 200→2000 + 中断兜底，避免打爆 CF 免费 50 次配额（2026-09-01）

## 下一步

1. **[P0] 3.5 上传 API** — `POST /api/rag/documents`，与灌库脚本复用同一套 service
2. **[P0] 3.6 知识库 UI** — 建库、上传 .md、文档列表/下载/删除（级联删向量）
3. **[P0] 3.7 GitHub 文档引入** — 拉取仓库 .md，相对路径图片转绝对 raw URL
4. **[P0] 3.8 图片展示 + 白名单渲染** — 检索结果带出 `images`，白名单校验堵住 prompt injection 外链缺口

## 阻塞 / 风险

- 综合题召回是已知难例（「整体流程」跨文件查询纯向量检索力不从心）— 阶段 C 混合检索 + Contextual Retrieval 解决
- 3.7 相对路径图片必须转绝对 raw URL，否则前端渲染 404
- subrequest 配额 — 已用阈值 2000 缓解；Hyperdrive 降级为可选优化（见 todo）

## 推迟项

todo.md 中有 10 项待办（新增「数据库迁移 Hyperdrive」），详见 [todo.md](todo.md)
