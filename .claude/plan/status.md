# 项目进度快照

> 更新于 2026-07-09

## 当前状态

**Phase 1 + 1.5 全部完成** — Phase 2 待启动，完成度约 0%

## 近期完成

- [1.30] 流式架构 V2（后台流保持 + 切回续显，合并 1.28/1.29/1.30）
- [1.18] ChatInput 优化（统一卡片方案 + 欢迎页快速操作）
- [1.26] Mermaid 渲染（markdown-it fence 识别 + 流式后客户端 SVG）
- [1.23] 设计规范体系（sky+zinc 主题、圆角/阴影/动效 token 化、组件改造）
- [—] CF 构建 OOM 修复（补 nitro.preset、双管线构建架构）

## 下一步

1. **[P0] Phase 2 启动** — Agent Runtime（ReAct 循环 + 上下文管理）
2. **[P0] 内置工具** — 搜索、计算器、时间等基础工具
3. **[P1] Agent API** — `/api/agent/run` 端点
4. **[P1] Skills 系统** — Loader + Registry（开发期 skill 框架）
5. **[P2] Agent UI** — 工具调用可视化、推理过程展示

## 阻塞 / 风险

- Phase 2 涉及 LLM 工具调用，DeepSeek 原生不支持，需以 OpenAI/Anthropic 为先验证
- 当前无紧急阻塞项

## 推迟项

todo.md 中有 5 项待办，详见 [todo.md](todo.md)
