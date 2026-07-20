# 待办事项

> 低优先级、推迟或未来可能做的事项。不纳入 roadmap Phase 规划。
> 通过 `/todo` 命令手动维护。

## 🔧 功能优化

- [ ] **SSE 重连** (来自 roadmap 1.17) — 网络闪断后自动恢复流式连接。推迟原因：场景极少、无法实现真重连只能从头生成，收益抵不上复杂度。推迟到 Phase 3+ 移动端适配时重新评估。详见 [流式中断保护方案](../docs/dev-log/2026-06-23-stream-interruption-protection.md)
- [ ] **编辑重发** (来自 roadmap 1.19) — 编辑已发送消息后重新发送。当前消息操作（复制+重新生成）已满足日常使用
- [ ] **键盘快捷键** (来自 roadmap 1.25) — Ctrl+N 新建对话、Esc 关闭面板、Ctrl+/ 快捷键提示（Ctrl+K 命令面板需搜索功能先落地）。当前鼠标操作已满足日常使用

## 📝 工程改进

- [ ] **API 单元测试** (来自 roadmap 1.31) — vitest + conversations CRUD 测试。推迟原因：conversations CRUD 无复杂业务逻辑，vitest + Nitro/Edge Runtime 集成成本高、个人项目无 CI 回归拦截需求。推迟到 Phase 2 Agent Runtime 有复杂逻辑（ReAct 循环、工具调用状态机）时再引入
- [ ] **部署构建优化** 目前使用Cloudflare Workers，可能没有处理静态资源的CDN，后续考虑优化。

## 🔮 远期规划

- [ ] **长期记忆系统** — 用户偏好记忆（跨对话提取偏好为结构化 profile）、长期记忆检索与上下文注入、记忆管理 UI。当前对话量少，Phase 2 先跑通 Agent 再说
- [ ] **用户自定义 Agent（GPTs-like）** — 管理页面配置 System Prompt + 选模型 → 生成限定领域对话 Agent。前置依赖：Phase 2 Agent Runtime
