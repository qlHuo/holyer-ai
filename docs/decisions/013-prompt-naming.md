# ADR-013: 统一命名为 Prompt（自定义提示词模板），在 Phase 2 第一步实现

> 日期：2026-07-23 · 状态：✅ 已采纳

---

## 背景

Phase 2 原计划参考 Claude Code 的 Skill 设计——将 Skill 定义为可执行能力单元（含工具白名单、权限级别），并放在整个 Phase 2 的最后阶段实现。经过架构分析，发现两个关键认知：

1. **提示词 + 可用工具 = Agent 能力**——这和 Claude Code 的 Skill 完全一致。区别仅在于工具集不同（Claude Code 有文件系统工具，本平台有 Web 工具），而非提示词系统的架构本身有差异。
2. **Prompt CRUD 对 Agent Runtime 零依赖**——DB 和 API 模式已在 Phase 1 就绪，可以立即开工并独立交付。

## 命名决策

**统一使用 Prompt（而非 Skill）。**

| 维度 | Prompt（采纳） | Skill（否决） |
|------|:---:|:---:|
| 语义精确性 | 就是提示词模板，名实相符 | 暗示工具绑定能力，第一步做不到 |
| 与 Claude Code 的区分 | 不会混淆 | 与 `.claude/skills/`（开发期技能）同名 |
| 用户认知负担 | 低（就是提示词） | 需理解平台自定义含义 |
| 向前兼容性 | 未来可升级为 Agent/Assistant | 概念已被占用 |

## 关键理由

1. **名实相符**：第一步做的是纯提示词 CRUD，没有工具绑定。叫 "Skill" 是在预支第二步的能力
2. **避免混淆**：项目已有 `.claude/skills/` 目录（开发期 Agent 技能），用户侧的 "Skill" 会造成开发者认知负担
3. **降低认知负担**：用户不需要理解"这个平台的 Skill 是什么意思"——就是提示词模板，直观
4. **向前兼容**：如果将来需要"提示词 + 工具绑定"的打包概念，届时再引入 "Agent" 或 "Assistant" 不迟

## 决策

- 统一命名为 Prompt，定位为**用户自定义提示词模板**——用户创建/管理提示词，发起对话时选择一个注入为系统上下文。Prompt 本身不含工具白名单；工具是 Agent Runtime 的职责。LLM 看到自定义提示词 + 工具列表后，自然按照提示词引导去调用工具。
- **Prompt CRUD 放在 Phase 2 第一步实现**（而非原计划的最后一步）。先做好提示词管理（让用户能定制 LLM 行为），再补齐 Agent Runtime 和工具生态（让 Prompt 真正能干事情）。

## 理由

- 用户创建的自定义提示词本身就是"简易 Agent"——这是 OpenAI Custom GPTs 的核心机制，无需 ReAct 循环
- 独立交付价值：第一步做完，用户立即可以在 Web 页面创建/管理/使用自定义提示词
- 为 Agent Runtime 铺路：提示词注入管线（`getPromptById` → `getCustomPrompt` → `buildPrompt`）在第一步就建好，Agent API 直接复用
- Web 平台无法使用文件系统方案（`.md` 文件 + `import.meta.glob`），数据库存储是唯一可行方案
- 学习路径优化：先掌握"提示词 → LLM 行为"的概念模型，再攻克"工具调用 → ReAct 循环"

## 与 Agent 工具系统的关系

Prompt 的能力上限由平台可用工具决定。Phase 2 第二步完工后（Agent Runtime + 工具），第一步创建的 Prompt 自动获得工具调用能力——用户不需要修改任何 Prompt 内容。LLM 自然会将自定义提示词中的引导与工具列表匹配，选择合适的工具执行。

## 实现顺序

1. Phase 2 第一步：Prompt CRUD（DB Schema → Service → API 端点：`GET/POST /api/prompts` + `GET/PUT/DELETE /api/prompts/:id`）→ 独立交付
2. Phase 2 第二步：Agent Runtime + 核心工具 → Prompt 自动升级为完整 Agent

## 命名映射

| 旧名 | 新名 |
|------|------|
| Skill / `skills` 表 | **Prompt / `prompts` 表** |
| `server/db/schema/skills.ts` | **`server/db/schema/prompts.ts`** |
| `server/service/skills/` | **`server/service/prompts/`** |
| `server/api/skills/*` | **`server/api/prompts/*`** |
| `skillId` | **`promptId`** |
| `getSkillById()` | **`getPromptById()`** |
| `getSkillPrompt()` | **`getCustomPrompt()`** |
| `Skill` 接口 | **`Prompt` 接口** |

## 相关文档

- [ADR-012：LLMStreamChunk 类型升级](012-llm-stream-chunk-type.md)
- [ADR-014：Agent 流式 DB 写入策略](014-agent-streaming-db-write.md)
- [Phase 2 Agent 系统设计方案](../../.claude/plan/phase2-agent-design.md)（含实现步骤）
- [提示词工程讨论](../dev-log/2026-07-09-prompt-engineering-and-phase2-planning.md)
