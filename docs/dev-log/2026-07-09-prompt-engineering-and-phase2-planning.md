# 2026-07-09 — 提示词工程认知澄清与 Phase 2 前规划 review

> 提示词是"人写给模型看的代码"——和代码一样需要结构化、可测试、可版本控制。

---

## 讨论背景

Phase 1 + 1.5 全部完成，进入 Phase 2 (Agent Runtime) 启动窗口。在开始编码前，对三个问题进行讨论：提示词工程到底是什么、在项目中如何落地、当前规划是否有遗漏。

---

## 1. 提示词工程是什么（以及不是什么）

### 三个常见误解

| 误解 | 事实 |
|------|------|
| 提示词工程 = 模型微调 | **不是**。微调改模型参数（权重），需要训练数据和 GPU；提示词工程改输入文本，API 调用方只能做后者 |
| 提示词工程 = 做一个管理页面 | **不是**。管理页面配 System Prompt 是 GPTs 构建器（产品功能），提示词工程是开发实践 |
| 提示词工程 = 写一次就行 | **不是**。它是持续迭代过程——观察模型行为 → 分析失败原因 → 调整 prompt → 验证效果 |

### 正确的定位

**提示词工程之于 Agent 开发，就像 CSS 之于前端开发。** 每个页面都在写 CSS，但不会在 roadmap 里单独列一个 Phase 叫"写 CSS"。同样，ReAct 指令、工具描述、Skill 的 prompt 模板——每个阶段都在做提示词工程，它不应该是独立 Phase，而是横切关注点。

### API 调用方的控制面

作为 LLM API 的消费者，能控制的只有：

```
你的控制面
├── system prompt（系统指令）
├── user message（用户输入）
├── 工具定义（tool description + parameters schema）
└── 其他参数（temperature、max_tokens、top_p）
```

模型权重在服务端，碰不到。对于 API 消费者来说，提示词工程是**唯一的行为控制手段**，没有替代方案。

---

## 2. 提示词工程的工程化做法

### 2.1 杂乱做法（要避免）

三个模块各自拼字符串，格式不统一、角色设定冲突、改一处忘了另一处：

```ts
// agent/runtime.ts
const prompt = `你是AI助手，请仔细思考。你可以使用工具...`

// skills/loader.ts — 风格完全不同
const injected = `你现在是一个有帮助的助手，请用以下技能...`

// rag/retrieval.ts — 再来一段
const context = `基于以下文档回答问题，文档内容：...`
```

### 2.2 好的抽象：PromptSegment + Builder

核心概念：统一的 `PromptSegment` 接口 + 按优先级拼装的 `buildPrompt()`。

```
server/service/prompt/
├── builder.ts        <- 核心：按优先级拼接 prompt 片段
├── segments/         <- 各模块只定义自己的"片段"
│   ├── base.ts       <- 基础角色设定（通用）
│   ├── react.ts      <- ReAct 指令（agent 提供）
│   ├── tools.ts      <- 工具列表描述（agent 提供）
│   ├── skill.ts      <- 当前激活的 skill 注入（skills 提供）
│   └── context.ts    <- RAG 检索结果注入（rag 提供）
└── types.ts          <- PromptSegment 接口定义
```

接口定义：

```ts
interface PromptSegment {
  id: string           // 唯一标识，如 'react-loop'
  priority: number     // 排序权重，base=0, tools=10, skill=20, rag=30
  content: string      // 纯文本
}
```

统一 builder：

```ts
function buildPrompt(segments: PromptSegment[]): string {
  return segments
    .sort((a, b) => a.priority - b.priority)
    .map(s => s.content)
    .join('\n\n')
}
```

调用方只管收集 segment，交给 builder：

```ts
const segments = [
  getBasePrompt(),           // 你是 AI 助手，请用中文回复
  buildToolsPrompt(tools),   // 可用工具列表
  buildSkillPrompt(skill),   // 当前技能注入
  buildContextPrompt(docs),  // RAG 检索结果
]
const systemPrompt = buildPrompt(segments)
```

### 2.3 这样做的好处

| 好处 | 说明 |
|------|------|
| **单一职责** | 每个模块只管自己的 prompt 片段，不越界 |
| **拼装顺序可控** | priority 决定谁在前谁在后，不怕冲突（如 RAG 上下文覆盖了 Skill 的行为约束） |
| **随时可调试** | 出问题时，收集 segments → 逐个排查谁的片段有问题 |
| **未来好扩展** | 新加 MCP、记忆系统，只需加一个 segment 文件 |
| **评估集可复用** | `buildPrompt()` 的输出直接喂给评估脚本，不用复制粘贴 |

### 2.4 评估集驱动迭代

不再靠肉眼判断 prompt 改得好不好，而是用评估集量化：

```ts
const cases = [
  { input: '今天天气怎么样？', expect: 'tool_call', tool: 'web_search' },
  { input: '你好',             expect: 'text_reply' },
  { input: '帮我算 235 * 17',  expect: 'tool_call', tool: 'calculator' },
]
// 改 prompt 后跑一遍：
// 3 个全对 → 改进有效，提交
// 3 个错了 2 个 → 改坏了，回退
```

这个评估集是维护 prompt 质量的保障——改 prompt 不再靠感觉，靠结果。对个人项目规模，一个 `eval-cases.ts` + `run-eval.ts` 脚本足够（约 100 行）。

---

## 3. Phase 2 前规划 review

### 3.1 Phase 顺序确认

**当前顺序（Phase 2 Agent → Phase 3 MCP → Phase 4 RAG）合理，不建议调换。**

| 维度 | 先做 Agent（当前） | 先做 RAG |
|------|-------------------|---------|
| 架构依赖 | ✅ MCP 和 RAG 都作为 Agent 的工具 | ⚠️ RAG 独立做完后，接入 Agent 需二次改造 |
| 用户价值 | 对话能自动搜索、计算——体验明显升级 | 需上传文档才有内容可搜，演示门槛高 |
| 学习收益 | ReAct 循环、工具调用协议——Agent 核心技能 | 偏数据工程 |

核心逻辑：**Agent 是编排层，RAG 检索本质上是一个 `search_knowledge_base` 工具。先有编排层，后接入工具，架构更自然。**

### 3.2 遗漏项

当前规划缺少以下内容，建议补入 Phase 2：

| 遗漏项 | 为什么重要 | 建议 |
|--------|-----------|------|
| **Agent 可观测性** | ReAct 循环是黑盒——不知道模型为什么选了工具 A 而不是 B、循环为什么提前终止。没有日志/追踪，调试全靠猜 | Phase 2 新增 2.6 |
| **Agent 安全护栏** | 工具可以搜索网络、执行计算。没有护栏，恶意 prompt 可能触发危险操作 | Phase 2 新增 2.7 |
| **行为评估** | Agent 行为正确性无法用传统单元测试衡量，"这个工具调用链对不对"是语义判断 | 并入横切关注点 |

### 3.3 远期项（记入 todo.md）

| 远期项 | 暂缓理由 |
|--------|---------|
| **长期记忆系统** | 记不住用户偏好和跨对话信息——但目前对话量少，Phase 2 先跑通再说 |
| **用户自定义 Agent（GPTs-like）** | 管理页面配 System Prompt + 选模型 → 生成限定领域对话——Agent Runtime 是硬前置依赖 |

---

## 关键洞察

- **提示词工程不是独立 Phase，是横切关注点**。Phase 2-4 每个阶段都在做，不应该也不需要在 roadmap 中单列
- **提示词需要像代码一样管理**：`PromptSegment` 接口 + 优先级拼装，避免散落在各模块的字符串拼接
- **可观测性是 Phase 2 最紧迫的遗漏**——Agent 调试极度依赖日志和追踪，没有它就是黑盒
- **安全护栏应该和工具系统一起做**——工具越强大越需要权限控制，是地基不是装修
- **评估集是提示词工程的闭环**——改了 prompt 要知道是好是坏，不能靠感觉

---

## 相关文档

- [ADR-008: Vercel AI SDK 不集成](../decisions/008-vercel-ai-sdk.md) — 同样的"自建优于依赖"、先理解再评估策略
- [ADR-009: 模型兼容性](../decisions/009-model-compatibility.md) — 工具调用格式在不同 Provider 间的差异（Phase 2 直接相关）
- [实施路线图](../../.claude/plan/roadmap.md)
- [待办事项](../../.claude/plan/todo.md)
