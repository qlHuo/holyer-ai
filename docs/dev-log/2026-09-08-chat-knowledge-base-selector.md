# 2026-09-08 — 聊天知识库选择器：交互设计与检索强度决策

> 核心洞察：知识库检索的"强约束"要拆成三个维度看——**范围 / 是否 / 采用**。装饰器只能硬约束**范围**（查哪些库），"是否检索""是否用检索结果作答"**无法硬约束**，本质上依赖模型理解。这是 agentic RAG 的天花板，任何实现方式都绕不开。

---

## 讨论背景

聊天框的"知识库选择器"是两处明确预留的坑：

- [09-06 RAG UI 实现](2026-09-06-rag-ui-component-reuse.md) 结尾记录："**聊天页选库器 — 后续单独做**（store 的 `kbOptions` 已预留）"
- [08-19 RAG 完整设计](2026-08-19-rag-knowledge-base-design.md) 扩展性表："多知识库 → 工具 `kbId?` 可选 → **阶段 B 加选择器**"

本次交付这个选择器的**方案与交互设计**（决策已定稿并实现，见文末「实现状态」）。围绕四个问题展开：①提示词与知识库是否互斥；②交互位置；③知识库是否必填；④开/关开关 vs 直接选库。

> **实现状态（2026-09-08 落地）**：功能已实现，类型检查通过。后端通过 `ChatOptions.toolContext`（`kbIds`/`disabledTools`）→ runner 透传 → KB 工具锁范围 / off 剔除定义；`searchChunks` 支持 `kbIds[]`；前端 `rag.store` 加 `kbMode`/`selectedKbIds`，`useChat` 两处发送点带 `kbConfig`，新组件 `ChatKnowledgeBaseSelector`（全 Nuxt UI 原生：`UButton` pill + `URadioGroup` 模式 + `UCheckboxGroup`#label slot 库多选）。同步新增前端规则「组件复用：Nuxt UI 优先，禁止自造」到 `.claude/rules/frontend.md`。

---

## 关键：知识库检索的"三约束维度"

把检索链路放大到三个决策点，看清"强约束"到底能强到哪：

| 维度 | 谁决定 | 能否硬约束 | 说明 |
|------|--------|:---:|------|
| **① 范围**（查哪些库） | 模型传 `args.kbId` | ✅ 能 | 装饰器在 `execute()` 里强制覆盖 `args.kbId` 为注入的 `allowedKbIds`，代码层面锁死，与模型理解无关 |
| **② 是否检索**（调不调工具） | 模型自主 | ❌ 不能 | 模型可判断"这是常识，直接答"而不调工具 |
| **③ 是否采用结果** | 模型自主 | ❌ 不能 | 模型可能调了工具却不引用检索内容，答非所查 |

**结论**：任何"让 LLM 决定"的 agentic 设计，其天花板就是 ②③ 靠模型。装饰器保障的是**范围**的确定性，不是**命中**与**采用**的确定性。

---

## 决策：指定库检索强度（已定稿）

| 用户状态 | 实现方式 | 效果 |
|---------|---------|------|
| **未选（默认）** | 现状 agentic 工具，`kbId` 不限制 | LLM 自主决定是否查、查全部库 —— 保持现有行为 |
| **选指定库** | agentic 工具 + **装饰器**注入 `allowedKbIds` | 范围强约束（①硬保）；是否/采用靠模型（②③） |
| **显式关闭** | 从 `toolDefinitions` 过滤掉 `search_knowledge_base` | 纯聊天/纯人格，检索能力彻底移除 |

### 对比：装饰器 vs 确定性预检索

| 维度 | 装饰器（agentic） | 确定性预检索（pipeline） |
|------|:---:|:---:|
| ① 范围 | 硬约束 | 硬约束 |
| ② 是否检索 | 靠模型 | 强制每次检索 |
| ③ 是否采用 | 靠模型 | **硬约束**（chunk 注入上下文，模型被迫看） |
| agentic 灵活性（模型判断无需查库/多轮迭代/自主换 query） | 保留 | 丢失 |
| 每次多一次检索延迟 + token | 无 | 有 |
| 实现侵入 | 小（只碰 KB 工具 + runner 注入点） | 需在 endpoint 加预检步骤 |

**选了装饰器**（轻量）：保留 agentic 灵活性与现有架构；接受 ②③ 靠模型。确定性预检索作为**未来可选加强**记录在案——若将来"指定库就想保证落地回答"成为刚需，再升级。

### 为什么提示词与知识库**不互斥**

两者是**正交**的：
- **提示词 = 行为层**（`systemPrompt`，人格/语气/规则）
- **知识库 = 检索层**（一个 Agent 工具，LLM 自主调）

在 [index.post.ts](../../server/api/chat/index.post.ts) 里两者分开传（`systemPrompt` 走 `chatOptions`，工具走 `toolDefinitions`），注入点不同、零冲突。

**不互斥的业界依据**：ChatGPT Custom Instructions + Knowledge 可并存；OpenAI GPTs 的 `Instructions` 与 `Knowledge` 是两个独立配置；Dify/Coze 的"系统提示词"与"知识库"分属两字段。互斥的是**直觉**不是技术——通常是心智模型（怕人格被知识库带偏），用"并排独立 pill"而非"分段二选一"即可避免视觉上的互斥暗示。

---

## 功能设计

### 状态层（`app/stores/rag.store.ts`）

- 新增 `kbMode: 'auto' | 'off' | 'custom'`（**默认 `'auto'`**）+ `selectedKbIds: string[]`（默认 `[]`）
- **全局单值、跨对话 sticky**，与 prompt 的 `selectedPromptId` 逻辑一致（用户已定）
- **不复用 `currentKbId`**——那是"二级页当前浏览的库"，语义不同，避免导航污染聊天选中

### 前端组件（新建 `ChatKnowledgeBaseSelector.vue`）

镜像 [ChatPromptSelector.vue](../../app/components/chat/ChatPromptSelector.vue) 的 pill 形态，但面板比 `USelectMenu` 重（模式单选 + 库多选两轴），用 `UPopover`/`UDropdownMenu` 自定义内容。

```
pill（三态文案）：
  知识库·自动（默认，中性灰低调）
  知识库（关，中性灰）
  知识库·产品文档…（指定，primary 高亮，多库截断+计数"N 个库"）

popover 面板（side: top，~w-80）：
  (•) 自动检索          ← 模式 radio
  ( ) 不引用
  ( ) 指定知识库        ← 此时下方激活
      ☑ 产品文档  24 个文档   ← 库多选（彩色头像 + docCount）
      ☐ 技术规范   8 个文档
      [全选/清空]
```

- 模式=自动 → 列表置灰"将检索全部知识库"；=不引用 → 列表隐藏/置灰；=指定 → 列表激活
- 布局：模型单独 + "提示词/知识库"一组（中间 `divider`），`flex-wrap` 防窄屏溢出
- 空态：无库显示"暂无知识库，去创建"（镜像 ChatPromptSelector 空态）；面板打开对 `kbList` 取交集剔除被删库（孤儿兜底）
- pill 加 UTooltip："自动模式下由 AI 决定何时检索"

### 数据流

- [useChat.ts:89](../../app/composables/useChat.ts#L89) 与 [:153](../../app/composables/useChat.ts#L153) 两处发送点，从 `ragStore` 取 `{ kbMode, selectedKbIds }`，随 `ChatApi.sendChatMessage` 传入（新增 `kbConfig` 参数）
- `/api/chat` schema 扩 `kbConfig?: { mode, kbIds? }`
- `index.post.ts`：`off` → 过滤掉 `search_knowledge_base`；`custom` → 装饰器注入 `allowedKbIds` 锁死范围；`auto`（默认）→ 现状

---

## 交互设计分析（四问结论）

| 问题 | 结论 | 理由 |
|------|------|------|
| ① 互斥？ | **不互斥** | 行为层 vs 检索层，注入点不同零冲突；业界主流均独立并存 |
| ② 位置 | **输入条工具栏**（第三颗 pill，与模型/提示词同排） | per-conversation 配置跟发送处一致；顶部留给"来源展示"不做选择控件 |
| ③ 必填？ | **不必填，默认"自动"** | agentic 检索按需触发，避免 naive RAG 每次强检的浪费/污染 |
| ④ 开/关 vs 选库 | **组合** | 以"选择"为核心，"开/关"由 pill 视觉态承载；自动/关/指定三态收敛单入口 |

**背景参考**：用户提供的参考图（下拉"选择知识库"含"产品文档 24 个文档/技术规范 8 个文档"）对应的正是 `kbList[].name + docCount`；`kbAvatar`（首字母方块 + 6 色固定板）已在 09-06 定稿，可直接用于库的行内彩色头像。

---

## 实现备忘 / 待办

以下为设计阶段识别、实现时需处理的点：

1. **装饰器注入点**：`runAgentLoop` 需把会话级 `kbIds` 与 KB 工具关联（装饰或注入）。改 `/api/chat` 时**不碰心跳与压缩**（[sse 铁律](../rules/sse.md)）。
2. **孤儿兜底**：选中的库被删后 `selectedKbIds` 留孤儿 ID，面板打开需与 `kbList` 取交集。
3. **工具调用准则**（[index.post.ts:130-138](../../server/api/chat/index.post.ts#L130-L138)）可补一条"涉及用户私有文档/项目资料 → search_knowledge_base"强化检索命中（现在只靠工具自身 description 引导）。
4. **多库展示**：多个库时 pill 截断 + 计数，面板多选加"全选/清空"。
5. **未来多用户**：全局单值在单用户系统 OK；加 auth 后应 per-user（甚至 per-conversation）。列为架构 note，本期不做。

---

## 关键洞察

- **"强约束"要拆三维度**：范围 / 是否 / 采用。硬约束能锁范围的确定性，"是否检索""是否采用结果"是 agentic 的天花板，靠模型。
- **指定库用装饰器锁范围**（轻量、保灵活），确定性预检索留给未来"硬落地"刚需——两套架构按"用户意图的强弱"各司其职。
- **提示词与知识库不互斥**：行为层 vs 检索层，注入点不同、零冲突；互斥只是心智幻觉，用并排独立 pill 而非分段控件规避。
- **默认"自动" = 保持现状**：现在工具恒注册、恒走 Agent 检索路径，所以默认 auto 不改变现有体验，只是补上"能关 / 能指定"的入口。

---

## 相关文档

- [RAG 知识库 UI 实现 + 公共组件复用清单](2026-09-06-rag-ui-component-reuse.md) — 明确本次"聊天页选库器后续单独做"
- [RAG 知识库功能完整设计方案](2026-08-19-rag-knowledge-base-design.md) — 扩展性表"阶段 B 加选择器"、Agentic RAG 定位
- [RAG 阶段 B 实施方案](2026-09-02-rag-phase-b-implementation.md) — 聊天选库器里程碑
- [架构设计](../../.claude/plan/architecture.md) — 3.5 RAG 管道章节
- [实施路线图](../../.claude/plan/roadmap.md) — Phase 3 状态
