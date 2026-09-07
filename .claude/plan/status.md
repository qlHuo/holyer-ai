# 项目进度快照

> 更新于 2026-09-06

## 当前状态

**Phase 3 = RAG 知识库** — 阶段 A ✅（12 问召回 92%，已上线 Neon）；阶段 B 产品化进行中（约 60%）：M1 上传 API + **M2 前半 3.6 知识库 UI 已交付**。

## 近期完成

- 3.6 知识库管理 UI — 一级卡片网格（建/改/删）+ 二级文档管理（上传/列表/下载/删除，同名 409 提示、超 500KB 拦截）+ 侧边栏入口
- 3.5 上传 API + KB CRUD（M1，2026-09-03）
- 3.8 渲染白名单前半（allowedImages prop，图片缺省降级）
- 3.2/3.3/3.4 检索管道 + 灌库脚本 + Agentic 闭环（2026-08-31）
- 3.1 Schema + pgvector（2026-08-30）

## 下一步

1. **[P0] 3.8 图片端到端后半（M3）** — retriever 带出 images + 工具返回图片 markdown + 前端从 tool 结果提取白名单
2. **[P0] 聊天选库器** — 选择知识库后对话检索默认限定（store 已预留 kbOptions；需动 /api/chat body + useChat + defaultKbId 注入）
3. **[P1] 3.7 GitHub 文档引入（M4）** — 浏览器编排，复用上传 API
4. **[P2] 阶段 C 质量增强（3.9-3.11）** — 混合检索 / Contextual Retrieval / 引用溯源

## 阻塞 / 风险

- 当前无阻塞项

## 推迟项

- **知识库文档在线编辑（markdown 编辑器）** — 本次明确预留（3.6 只交付上传/列表/下载/删除），编辑功能较复杂后续单独实现
- **公共组件抽取** — RAG UI 本次独立实现，prompts/rag 存在成对重复；候选清单见 [复用记录](/docs/dev-log/2026-09-06-rag-ui-component-reuse.md)
- todo.md 中有 10 项待办，详见 [todo.md](todo.md)
