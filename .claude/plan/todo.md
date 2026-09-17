# 待办事项

> 低优先级、推迟或未来可能做的事项。不纳入 roadmap Phase 规划。
> 通过 `/todo` 命令手动维护。

## 🔧 功能优化

- [ ] **SSE 重连** (来自 roadmap 1.17) — 网络闪断后自动恢复流式连接。推迟原因：场景极少、无法实现真重连只能从头生成，收益抵不上复杂度。推迟到 Phase 3+ 移动端适配时重新评估。详见 [流式中断保护方案](../../docs/dev-log/2026-06-23-stream-interruption-protection.md)
- [ ] **编辑重发** (来自 roadmap 1.19) — 编辑已发送消息后重新发送。当前消息操作（复制+重新生成）已满足日常使用
- [ ] **键盘快捷键** (来自 roadmap 1.25) — Ctrl+N 新建对话、Esc 关闭面板、Ctrl+/ 快捷键提示（Ctrl+K 命令面板需搜索功能先落地）。当前鼠标操作已满足日常使用
- [ ] **后台流中途切回残留** (来自 Phase 2 审查) — 切换回「工具执行中」的对话时，工具卡片以 done 态渲染（实际仍 running），最终文本可能不写入 messages。根因：`agentToolCalls` 实时态与 DB `messages` 双轨在切回时未合流。推迟原因：需完整双轨统一（阶段 2 完整版），风险高。详见 [Agent ReAct 已知问题](../../docs/dev-log/2026-08-06-agent-react-known-issues.md)
- [ ] **图片白名单是否也放宽到对话级**（来自 3.11 评估）— 引用溯源白名单已放宽到「整个对话」（LLM 追问时会复用上一轮来源），图片白名单仍是「本轮检索结果」，两者行为不一致：同一来源，chip 跨轮能点、其附图跨轮不出。放宽的风险边界很小（放行的 URL 集合是已放行过的集合的并集），但 3.8 把「按次生成」写成了明确的安全边界，需单独决策，不顺手改。
- [ ] **预览图片白名单的范围**（来自 3.11 评估）— 文档预览用「该文档所有 chunk 的图片并集」作白名单，从 GitHub 引入的**第三方**文档会一次性请求其全部图片（把 IP/UA 暴露给多个第三方域）。范围从「本轮 5 个 chunk」扩到「整篇文档」，性质与 3.8 相同但面更大。收紧方式：预览只放行被引用 chunk 的图，或预览一律不出图。

## 📝 工程改进

- [ ] **引用溯源的引用率评测**（来自 3.11 评估）— 现有 `eval-prompt` 快照里没有 `search_knowledge_base`、判定只看首个 tool call 名字/参数，完全断言不到「回答是否标注了来源」。当前只人工验过 1 次（deepseek-v4-pro 标注正常），换模型/换问法可能不标。需要新 harness：真跑 Agent 循环 + DB + embedding，断言「可答问题至少出现一个可解析且属于白名单的 key」「无关问题不出现 citation」。对应横切关注点 X4。
- [ ] **3.10 重灌会让历史引用集体失效**（来自 3.11 评估）— 引用存的是 docId 快照；3.10 全量重灌后所有 docId 换新，全部历史对话的 citation 会一起 404。预览弹层已有降级提示，但那一刻会集中爆发，**3.10 的验收清单里要加这一条**。
- [ ] **API 单元测试** (来自 roadmap 1.31) — vitest + conversations CRUD 测试。推迟原因：conversations CRUD 无复杂业务逻辑，vitest + Nitro/Edge Runtime 集成成本高、个人项目无 CI 回归拦截需求。推迟到 Phase 2 Agent Runtime 有复杂逻辑（ReAct 循环、工具调用状态机）时再引入
- [ ] **部署构建优化** 目前使用Cloudflare Workers，可能没有处理静态资源的CDN，后续考虑优化。
- [ ] **PromptSegment 抽象落地**（源自 [07-09 提示词工程讨论](../../docs/dev-log/2026-07-09-prompt-engineering-and-phase2-planning.md) 2.2 节，仅设想未实现）— 当前 prompt 散落在 [index.post.ts](../../server/api/chat/index.post.ts)（dateContext + toolUsageGuidelines 硬编码）、system-prompt.ts、工具描述等 5 层。按设想建 `server/service/prompt/`（PromptSegment 接口 + buildPrompt() 按 priority 拼接）。推迟原因：当前 prompt 仅 2 段 + 4 工具，抽象收益不抵成本。触发点：MCP 注入工具描述、以及工具增多导致 toolUsageGuidelines 膨胀时（Agentic RAG 下检索结果走 tool 消息，不经过 system prompt 组装），片段涨到 5~6 段再落地。连带收益：解决评测脚本快照漂移（buildPrompt() 统一入口，评测直接 import 而非复制快照）。
- [ ] **数据库迁移 Hyperdrive** (来自 RAG 线上排查 2026-09-01) — 生产用 neon-http 直连 Neon，每次 DB 读写消耗 1 次 subrequest（免费计划 50 次/请求上限）。已通过「阈值 2000 增量写入 + 中断兜底」缓解（正常 RAG 对话 ~13 次、刷新最多丢 2000 字），Hyperdrive 降级为可选优化。触发点：极端场景（超长回答 + 多轮检索）逼近上限、或想恢复高频增量写入时再评估。待验证：免费计划可用性、Nitro binding 访问、缓存一致性、连接生命周期管理。详见 [CF Workers subrequest 超限排查](../../docs/dev-log/2026-09-01-cf-workers-subrequest-limit.md)
- [ ] **公共组件抽取**（源自 2026-09-06 RAG UI）— prompts 与 rag 出现成对重复：三段式状态区/卡片网格+骨架/删除确认 Modal/表单 Modal 基座/卡片 hover 操作/空态/时间格式化（无公共 date util，最该先抽）/Blob 下载。本次 RAG UI 按独立实现，待 UI 稳定后统一抽。候选清单见 [复用记录](../../docs/dev-log/2026-09-06-rag-ui-component-reuse.md)

## 🔮 远期规划

- [ ] **长期记忆系统** — 用户偏好记忆（跨对话提取偏好为结构化 profile）、长期记忆检索与上下文注入、记忆管理 UI。当前对话量少，Phase 2 先跑通 Agent 再说
- [ ] **用户自定义 Agent（GPTs-like）** — 管理页面配置 System Prompt + 选模型 → 生成限定领域对话 Agent。前置依赖：Phase 2 Agent Runtime
