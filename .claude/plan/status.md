# 项目进度快照

> 更新于 2026-10-19

## 当前状态

**Phase 3 = RAG 知识库 ✅ 已完成**（阶段 A/B/C 全部收官）。3.10 Contextual Retrieval 完整实现并 A/B 验证后**判定不采用**，实现与数据已回退到动手前状态。

**下一阶段：Phase 4A = MCP 接入**。技术设计已定稿（[phase4-mcp-design.md](phase4-mcp-design.md)），范围收敛为 `tools` 原语 + Streamable HTTP；垂直场景拆为 Phase 4B 后置。

## 近期完成

- 4A.2 工具适配 + 请求级注册表（2026-10-21）— `createMcpTools`（命名空间 / Schema 清洗 / 结果拍平 / `isError` → `McpToolError`）；`createToolRegistry` 按请求构建；runner 接收注册表并支持 `cacheable`；开发环境通过 `NUXT_MCP_DEV_SERVERS` 跑通"模型调用 MCP 工具"全链路。**临时项：M3 接入 DB 后移除 `mcpDevServers` 运行时配置**
- 4A.1 MCP Client（2026-10-19）— `McpClient`（modern 2026-07-28 / legacy 2025-06-18 降级、JSON + SSE 响应、分页、超时与取消）+ `probeMcpServer` + `url-safety` 抽取 + dev-only 测试 Server（modern/legacy/sse/broken）
- 4A.0 PromptSegment 抽象（2026-10-19）— 系统提示词改为按段拼装（`server/service/system-prompt/`）；修正线上 `dateContext` 时区偏移（Workers 为 UTC）；评测脚本改为复用同一实现并迁至 `run.ts`
- 3.10 实现 + A/B 验证，判定不采用（2026-10-17）— chunk 召回无提升，chunkMRR 0.808→0.642；Contextual BM25 负收益（[负结果记录](../../docs/dev-log/2026-10-17-contextual-retrieval-negative-result.md)）
- 评测体系修正（2026-10-17）— 补 chunk 级断言、修正无效用例，基线 12/12、chunkMRR 0.825
- 3.11 引用溯源线上落地 + 浏览器验收（2026-09-17）
- 3.9 混合检索完整落地（2026-09-16）— exact MRR 0.926→1.000
- 3.7 GitHub 文档引入（2026-09-09）｜ 3.8 图片端到端验收（2026-09-08）

## 下一步

1. **[P0] 4A.3 MCP 管理界面** — DB 表 + API + 管理页（替换临时 `mcpDevServers` 配置）
2. **[P1] 4A.4 安全与可靠性兜底**
3. **[P2] Phase 4B 垂直场景框架 + 示例场景**
4. **[P2] 检索复评** — 语料扩充或引入 rerank 后重跑评测（基线随语料失效）

## 阻塞 / 风险

- **当前无阻塞项**
- 3.10 已完整回退：生成器/回填脚本删除、`contextual_text` 数据清空（列保留）、`retriever.ts` 还原
- 评测基线（chunkMRR 0.825）只在当前语料有效，扩充语料后需重跑

## 推迟项

todo.md 中有 15 项待办，详见 [todo.md](todo.md)。
