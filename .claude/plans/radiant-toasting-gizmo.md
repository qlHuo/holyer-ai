# Phase 2 实施方案：Agent Runtime + Skills 系统

> 更新于 2026-07-10

## 核心架构决策

**混合架构**：

```
/api/chat       → 手写 Provider 层（Phase 1 代码，不变）
/api/agent/run  → AI SDK（ai + @ai-sdk/openai + @ai-sdk/anthropic）
```

**为什么混合？**
- `/api/chat` 是纯文本流，Phase 1 手写代码已稳定，没有改的理由
- `/api/agent/run` 需要工具调用 + ReAct 循环，手写意味着要在 openai.ts 和 anthropic.ts 中各自处理 tool_calls delta（分片 JSON）和 tool_use content_block（累积 JSON）的格式差异——这是"记 API 文档细节"不是"学 Agent 架构"
- AI SDK 用 `streamText()` + `tool()` 一行搞定 Provider 格式差异，把精力留给真正有价值的事：Prompt 设计、Skill 抽象、安全护栏

**不动的代码**：`server/service/llm/` 下所有文件保持不变。`factory.ts`、`openai.ts`、`anthropic.ts`、`deepseek.ts` 继续为 chat 端点服务。

---

## 一、产品方案

### 1.1 用户价值

Phase 1 的核心能力是"对话"——用户问，AI 答。但 AI 被限制在训练数据的边界内：不会算数、不知道当前时间、无法搜索实时信息。

Phase 2 赋予 AI **使用工具的能力**：

| 场景 | Phase 1（纯对话） | Phase 2（Agent） |
|------|-------------------|-------------------|
| "235 × 17 等于多少" | 可能算错，token 预测不可靠 | 调 calculator → 精确结果 3995 |
| "现在几点了" | 不知道，训练截止日期 | 调 current_time → 准确时间 |
| "帮我审查这段代码" | 通用回复，无结构化检查 | 启用 code-review Skill → 按清单逐项审查 |

### 1.2 用户操作

```
第一步：点击输入框左侧的 Agent 开关 → 切换为 Agent 模式
第二步：正常输入问题、发送
```

前端根据 Agent 开关状态决定调用哪个 API：

```
Agent 开关 OFF → /api/chat      （Phase 1 逻辑，不变）
Agent 开关 ON  → /api/agent/run （Phase 2 新增）
```

### 1.3 UI 布局

```
┌──────────────────────────────────────────────────┐
│  [对话列表]  │  当前对话标题                       │
│              │  ──────────────────────────────   │
│  对话 A      │                                    │
│  对话 B   ●  │  用户：帮我算 235 × 17             │
│  对话 C      │                                    │
│              │  AI：我来帮你计算                   │
│              │  ┌ 🔧 调用工具：calculator ────┐   │
│              │  │ 表达式：235 * 17              │   │
│              │  │ ✅ 结果：3995                 │   │
│              │  └──────────────────────────────┘   │
│              │  AI：235 × 17 = 3995               │
│              │                                    │
│              │  ──────────────────────────────   │
│              │  [⚡ Agent: ON] [模型选择器]        │
│              │  [输入框________________] [发送]    │
└──────────────────────────────────────────────────┘
```

### 1.4 渐进式交付

| 阶段 | 用户可见的变化 | 核心交付 |
|------|---------------|---------|
| **2a. 基础 Agent** | 输入框多了一个 Agent 开关，AI 能调计算器、查时间 | PromptSegment + AI SDK 接入 + 两个内置工具 |
| **2b. Agent UI** | 对话中显示工具调用卡片 | 前端 SSE 处理 + ToolCallCard 组件 |
| **2c. Skills** | Skill 选择器，选"代码审查"后 AI 按专业模式回答 | Skills Loader + Registry |
| **2d. 打磨** | 工具调用日志、Token 统计、安全护栏 | 可观测性 + 安全 |

---

## 二、架构决策

### 决策 1：Agent 独立端点

新建 `/api/agent/run`，不复用 `/api/chat`。理由：
- 生命周期不同：chat 是单次 LLM 调用，Agent 是多轮循环
- Agent 需要新的 SSE 事件（`tool_call`、`tool_result`），合入会导致 if/else 分支
- 独立端点独立迭代，不影响现有聊天稳定性
- **前端通过 Agent 开关直接决定调哪个端点**

### 决策 2：AI SDK 仅用于 Agent 层

AI SDK 的 `streamText()` 负责：工具调用格式归一化 + ReAct 循环控制。手写 Provider 层不动，chat 端点继续使用。

```
Agent 层（新）      AI SDK (ai, @ai-sdk/openai, @ai-sdk/anthropic)
                    ↓
Chat 层（不变）     手写 Provider (server/service/llm/)
```

### 决策 3：纯服务端工具执行

内置工具（计算器、时间）是纯计算，直接同步执行。Cloudflare Workers 不支持 `vm2`/`isolated-vm`。安全靠权限分级控制。

### 决策 4：流式文本 + 工具事件交织

用户实时看到模型的思考过程：
```
META → TEXT("让我搜索一下…") → TOOL_CALL(calculator) → TOOL_RESULT(3995) → TEXT("结果是…") → DONE
```

AI SDK 的 `fullStream` async iterable 直接提供这种事件流，无需手动解析。

### 决策 5：工具调用作为独立 Message 存储

利用 DB 已有的 `tool` role 和 `toolCalls`/`toolCallId` 列，每条工具调用和结果各自存为一条 message。

### 决策 6：Skills 即 Markdown 文件

YAML frontmatter + Markdown body，放 `skills/` 目录。AI SDK 不涉及——这是纯应用层逻辑。

### 决策 7：工具权限分级

`readonly`（自动执行）→ `readwrite`（自动，记录日志）→ `dangerous`（需用户确认）。Phase 2 内置工具都是 `readonly`。

---

## 三、实现步骤

### Step 1：依赖安装 + AI SDK Provider 映射

安装三个包：
```bash
npm install ai @ai-sdk/openai @ai-sdk/anthropic
```

Edge Runtime 兼容性：三者均基于 `fetch` API，无 Node.js 依赖，Cloudflare Workers 兼容。

新建 `server/service/agent/providers.ts`——AI SDK 的 provider 映射（独立于手写 factory.ts）：

```ts
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'

// 获取 AI SDK LanguageModel 实例
function getAgentModel(provider: string, model: string) {
  // openai → createOpenAI({ apiKey })(model)
  // anthropic → createAnthropic({ apiKey })(model)
  // domestic (deepseek/qwen/glm/...) → createOpenAI({ baseURL })(model)
}
```

**关键**：国内模型（DeepSeek、千问等）通过 `createOpenAI({ baseURL })` 接入——不需要单独适配器。

### Step 2：PromptSegment 抽象层

```
server/service/prompt/
├── types.ts           # PromptSegment 接口
├── builder.ts         # buildPrompt(): 按 priority 排序拼接
├── segments/
│   ├── base.ts        # 基础角色设定（priority=0）
│   ├── react.ts       # ReAct 循环指令（priority=10）
│   └── tools.ts       # 工具列表描述（priority=20）
```

```ts
interface PromptSegment {
  id: string
  priority: number       // base=0, react=10, tools=20, skill=30
  content: string
}
function buildPrompt(segments: PromptSegment[]): string
```

Chat 端点不受影响——它继续用 `server/utils/system-prompt.ts`。

Agent 端点调用 `buildPrompt([base(), react(), tools(), skill?])` → 传给 `streamText({ system })`。

### Step 3：内置工具

使用 AI SDK 的 `tool()` 定义工具：

```ts
// server/service/agent/tools.ts
import { tool } from 'ai'
import { z } from 'zod'

const calculator = tool({
  description: '安全计算数学表达式。支持 +、-、*、/、()。示例："235 * 17"',
  parameters: z.object({
    expression: z.string().describe('数学表达式')
  }),
  execute: async ({ expression }) => {
    // 安全 eval（白名单运算符）
    const result = Function('"use strict"; return (' + expression + ')')()
    return { result }
  }
})

const currentTime = tool({
  description: '获取当前日期和时间',
  parameters: z.object({}),
  execute: async () => ({
    iso: new Date().toISOString(),
    readable: new Date().toLocaleString('zh-CN')
  })
})
```

权限元数据通过 `tool` 的 `description` 字段携带（AI SDK 不支持自定义元数据，权限检查在外层 `executeTool()` 包装函数中做）。

### Step 4：Agent Runtime（分两阶段：学习 → 生产）

> ⚠️ **这是 Phase 2 最核心的学习步骤**。详见[学习路径说明](#七学习路径说明)。

#### 4a. 手写 ReAct 循环（学习阶段）

用 AI SDK 的 `streamText({ maxSteps: 1 })` 做单次 LLM 调用，**循环控制自己写**：

```ts
// server/service/agent/runtime.ts（学习版）
import { streamText } from 'ai'

async function runAgent(options: AgentOptions): Promise<ReadableStream<SSEChunk>> {
  const model = getAgentModel(options.provider, options.model)
  const system = buildPrompt([base(), react(), toolsPrompt(options.tools)])

  // ============================================================
  // 手写 ReAct 循环
  // ============================================================
  const messages = [...options.messages]  // 你手动管理消息数组
  const MAX_ITERATIONS = 10

  return new ReadableStream({
    async start(controller) {
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        // 1. 单次 LLM 调用（不做自动循环）
        const result = streamText({
          model,
          system,
          messages,        // ← 每次循环传入不断增长的消息数组
          tools: getToolDefinitions(options.tools),
          maxSteps: 1,     // ← SDK 只做一轮，循环你来控制
          maxTokens: 4096,
        })

        // 2. 手动消费 fullStream
        let hasToolCall = false
        const toolResults: Message[] = []

        for await (const chunk of result.fullStream) {
          switch (chunk.type) {
            case 'text-delta':
              controller.enqueue(SSE_TEXT(chunk.textDelta))    // → SSE TEXT
              break
            case 'tool-call':
              hasToolCall = true
              controller.enqueue(SSE_TOOL_CALL(chunk))         // → SSE TOOL_CALL
              break
            case 'tool-result':
              toolResults.push({                                // ← 你决定结果怎么存
                role: 'tool',
                toolCallId: chunk.toolCallId,
                content: JSON.stringify(chunk.result),
              })
              controller.enqueue(SSE_TOOL_RESULT(chunk))       // → SSE TOOL_RESULT
              break
            case 'finish':
              // usage 信息从 chunk 中提取
              break
          }
        }

        // 3. 你决定什么时候停
        if (!hasToolCall) break

        // 4. 你决定怎么组织上下文——把工具结果 push 回 messages
        messages.push(...toolResults)

        // 5. 上下文裁剪（超过 50 条时保留 system + 最近 20 轮）
        if (messages.length > 50) {
          messages = trimMessages(messages, { keepSystem: true, keepRecent: 20 })
        }
      }
      controller.enqueue(SSE_DONE({ usage }))
      controller.close()
    }
  })
}
```

**这个阶段你会亲手学到**：
- 消息数组如何随每轮循环增长（system → user → assistant+toolCalls → tool results → …）
- `maxSteps: 1` 的 LLM 返回什么、不返回什么——直观看到单轮调用的边界
- 为什么 `tool-result` 要 push 回 `messages` 数组（下一轮 LLM 需要看到上轮的工具结果才能继续推理）
- 什么时候该停止（没有 tool_call 就是 LLM 觉得信息够了）
- 上下文超了怎么裁剪（保持 system prompt + 最近的对话轮次）

#### 4b. 切换到生产模式（对比学习）

手写循环跑通并理解后，**对比迁移到 SDK 托管**：

```ts
// server/service/agent/runtime.ts（生产版）
import { streamText, stepCountIs } from 'ai'

async function runAgent(options: AgentOptions): Promise<ReadableStream<SSEChunk>> {
  const model = getAgentModel(options.provider, options.model)
  const system = buildPrompt([base(), react(), toolsPrompt(options.tools)])

  const result = streamText({
    model,
    system,
    messages: options.messages,
    tools: getToolDefinitions(options.tools),
    stopWhen: stepCountIs(10),  // ← SDK 替你做循环控制
    maxTokens: 4096,
  })

  return transformToSSE(result.fullStream)  // chunk 映射逻辑不变
}
```

**diff 很直观——删掉的就是 SDK 替你做的**：循环控制、消息累积、停止判断。chunk → SSE 的映射逻辑在两个版本中完全相同，直接复用。

两个版本都留在 git 历史中（通过 commit 记录），随时可回顾手写版本。

**AI SDK 替你做的事**（也是你亲手写过后才能对比出来的）：
- 检测 tool_calls → 自动执行工具 → 自动把结果喂回 LLM → 继续循环
- `stopWhen: stepCountIs(10)` 自动终止
- `fullStream` 统一输出格式，不区分 OpenAI/Anthropic

**AI SDK 不做的事**（你的学习重点）：
- Prompt 工程（base/react/tools 三个 segment 怎么写效果好）
- 工具定义设计（什么参数、什么描述能引导 LLM 正确调用）
- SSE 事件流转换（AI SDK chunk → 本项目 SSE 格式）
- Skills 注入到 system prompt
- 上下文管理策略（消息裁剪、token 预算）
- 可观测性埋点（工具调用日志、循环追踪）

### Step 5：Agent API 端点

```
server/api/agent/
├── run.post.ts     # SSE 端点
└── schema.ts       # Zod 验证
```

端点结构（遵循现有 SSE 端点模式）：
1. Zod 验证请求体
2. 获取/创建对话上下文
3. 调用 `runAgent()` 获取 `ReadableStream<SSEChunk>`
4. 交给 `createSSEResponse()` 返回

新增 SSE 事件类型（追加到 `shared/types/sse.ts`）：
```ts
TOOL_CALL: 'tool_call',
TOOL_RESULT: 'tool_result',
```

### Step 6：Skills 系统

```
server/service/skills/
├── types.ts        # Skill 接口
├── loader.ts       # Markdown frontmatter 解析
└── registry.ts     # import.meta.glob 发现 + 缓存

skills/             # 应用级 skill 文件
└── code-review.md  # 示例技能
```

Skill 文件格式：
```markdown
---
name: code-review
description: 代码审查助手
priority: 30
---

## 角色
你是一名资深代码审查专家...
## 检查清单
1. ...
```

激活的 skill 通过 PromptSegment（priority=30）注入 system prompt。与 AI SDK 无关——纯应用层。

### Step 7：Agent UI

#### 7a. Agent 开关

在 `ChatInput.vue` 中新增：

```
状态：chatStore.isAgentMode: boolean（localStorage 持久化）
ON  → sendMessage 调用 /api/agent/run
OFF → sendMessage 调用 /api/chat（现有逻辑）
```

#### 7b. 前端 SSE 处理

`useChat.ts` 新增 `sendAgentMessage()`：
- 调用 `/api/agent/run`
- `handleSSEEvent` 增加 `TOOL_CALL`、`TOOL_RESULT` case

#### 7c. 组件

| 文件 | 变更 |
|------|------|
| `app/stores/chat.store.ts` | +`isAgentMode`、+`addToolCall`、+`addToolResult` |
| `app/components/agent/ToolCallCard.vue` | 新建——工具调用卡片（执行中/完成/失败三态） |
| `app/components/chat/ChatMessage.vue` | `role='tool'` 时渲染 ToolCallCard |
| `app/components/chat/ChatInput.vue` | +Agent 开关按钮 |

### Step 8：可观测性 + 安全护栏

- 结构化日志：每次工具调用记录时间、工具名、参数、耗时、结果
- Token 统计：AI SDK 的 `finish` chunk 携带 `usage` → 存入 DB 或在 DONE 事件中返回
- 安全护栏：`executeTool()` 中检查权限等级，`dangerous` 工具需前端确认

---

## 四、文件变更清单

### 新建（17 个）

| 文件 | 步骤 |
|------|------|
| `server/service/agent/providers.ts` | S1 |
| `server/service/agent/types.ts` | S3 |
| `server/service/agent/tools.ts` | S3 |
| `server/service/agent/runtime.ts` | S4 |
| `server/service/prompt/types.ts` | S2 |
| `server/service/prompt/builder.ts` | S2 |
| `server/service/prompt/segments/base.ts` | S2 |
| `server/service/prompt/segments/react.ts` | S2 |
| `server/service/prompt/segments/tools.ts` | S2 |
| `server/api/agent/run.post.ts` | S5 |
| `server/api/agent/schema.ts` | S5 |
| `server/service/skills/types.ts` | S6 |
| `server/service/skills/loader.ts` | S6 |
| `server/service/skills/registry.ts` | S6 |
| `skills/code-review.md` | S6 |
| `app/components/agent/ToolCallCard.vue` | S7 |

### 修改（6 个）

| 文件 | 步骤 | 变更 |
|------|------|------|
| `package.json` | S1 | +`ai`、`@ai-sdk/openai`、`@ai-sdk/anthropic` |
| `shared/types/sse.ts` | S5 | +`TOOL_CALL`、`TOOL_RESULT` SSE 事件 |
| `app/composables/useChat.ts` | S7 | +`sendAgentMessage()`、新 SSE case |
| `app/stores/chat.store.ts` | S7 | +`isAgentMode`、+`addToolCall`、+`addToolResult` |
| `app/components/chat/ChatMessage.vue` | S7 | +`role='tool'` 渲染 |
| `app/components/chat/ChatInput.vue` | S7 | +Agent 开关 |

### 不变的文件

`server/service/llm/` 下所有文件（types.ts、factory.ts、openai.ts、anthropic.ts、deepseek.ts）——继续为 `/api/chat` 服务，零改动。

---

## 五、风险与缓解

| 风险 | 缓解 |
|------|------|
| AI SDK 与 Cloudflare Workers Edge Runtime 不兼容 | `ai` core 使用标准 `fetch` + `ReadableStream`；安装后先跑 `npx nuxi build` + `wrangler pages dev` 验证 |
| `@ai-sdk/anthropic` 依赖与现有 `@anthropic-ai/sdk` 冲突 | 独立依赖，互不影响。验证后考虑移除旧 `@anthropic-ai/sdk`（但非必须） |
| DeepSeek 工具调用不支持 | AI SDK 的 `createOpenAI({ baseURL })` 可接入 DeepSeek，但工具调用质量取决于模型本身。DeepSeek V4 Pro 的工具调用能力需实测 |
| ReAct 循环超时（Cloudflare 100s） | `stopWhen: stepCountIs(10)` + 每轮 LLM 调用消耗 wall time，正常 3-5 轮 → 30-60s 可完成。30s 心跳保活 |
| AI SDK 版本升级 break change | 锁定 `ai` 主版本号 |

---

## 六、验证方案

```bash
# 1. 类型检查
npx nuxi typecheck

# 2. 构建验证（Edge Runtime 兼容性）
npx nuxi build
npx wrangler pages dev dist/

# 3. 启动开发服务器
npx nuxi dev

# 4. 测试 Agent API
curl -N -X POST http://localhost:3000/api/agent/run \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai",
    "model": "gpt-4.1-mini",
    "messages": [{"role":"user","content":"帮我算 235 乘以 17"}],
    "tools": ["calculator"]
  }'

# 预期 SSE 事件序列：
# META → TEXT → TOOL_CALL(calculator) → TOOL_RESULT(3995) → TEXT → DONE

# 5. Chat 端点回归（确保手写 Provider 未被影响）
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai",
    "model": "gpt-4.1-mini",
    "messages": [{"role":"user","content":"你好"}]
  }'

# 6. 前端验证
# - Agent 开关 OFF → 正常对话（回归 Phase 1）
# - Agent 开关 ON → 工具调用卡片正确渲染
# - 切换对话 → Agent 流正确隔离
# - DeepSeek 在 Agent 模式下被过滤/提示不支持
```

---

## 七、学习路径说明

> 本章节是 2026-07-10 讨论的关键输出。记录为什么选择"先手写再切换"而非"直接用 SDK 托管循环"。

### 7.1 为什么 ADR-008 没说死

[ADR-008](../../docs/decisions/008-vercel-ai-sdk.md) 的决策是"Phase 1-2 不集成 Vercel AI SDK"。当时的时间点是 2026-05-31，Phase 1 还没开始。

Phase 1 结束后，手写三个 Provider（OpenAI + Anthropic + DeepSeek）的学习目标已完成。到了 Phase 2，面对的问题从"LLM API 协议长什么样"变成了"工具调用格式差异怎么处理"。

这两个问题的含金量不同：

| Phase | 核心问题 | 手写的学习价值 |
|-------|---------|-------------|
| Phase 1 | LLM API 协议：SSE 帧格式、流式 token 解析、请求/响应结构 | **高** — 理解一次，终身受用 |
| Phase 2 | 工具调用格式：OpenAI 分片 JSON vs Anthropic 累积 JSON、delta 索引管理 | **低** — 记 API 文档细节，不是架构理解 |

**结论**：Phase 1 手写的理由在 Phase 2 不成立。不是"偷懒"，是"不值得花时间学的东西不该手写"。

### 7.2 那 ReAct 循环本身呢？

ReAct 循环的逻辑是 Phase 2 的**核心架构理解**——必须亲手写过才能懂。但它是 ~30 行的 for 循环 + 消息数组管理，不依赖 Provider 层的格式细节。

所以拆成两段：

| 阶段 | 做什么 | 学习重点 |
|------|--------|---------|
| **4a（学习）** | `maxSteps: 1`，手写循环控制 | 消息数组增长、停止判断、上下文裁剪 |
| **4b（生产）** | `stopWhen: stepCountIs(10)` | 对比 SDK 托管 vs 手写的差异 |

**关键**：4a 和 4b 的 chunk → SSE 映射逻辑完全相同。从 4a 切到 4b 只是一个 API 调用的变化（加 `stopWhen`），不是推倒重来。

### 7.3 AI SDK 在你项目中的角色边界

```
你的代码                          AI SDK 的代码
─────────────────────────────────────────────
PromptSegment 设计               ❌ 不涉及
工具定义 + 描述                  用 tool() 辅助函数（只做 schema 定义）
ReAct 循环控制（4a）             单次 LLM 调用（maxSteps: 1）
ReAct 循环控制（4b）             自动循环（stopWhen + stepCountIs）
chunk → SSE 事件映射            ❌ 不涉及，纯你的逻辑
Skills 系统                     ❌ 不涉及
可观测性埋点                     ❌ 不涉及
安全护栏                         ❌ 不涉及
消息持久化到 DB                  ❌ 不涉及
```

AI SDK 只占 Agent 层约 1/3 的代码量——它管的是"跟 LLM 打交道"这部分，而 Prompt、Skills、可观测性、安全这些才是 Phase 2 真正的学习产出。

### 7.4 后续回顾

4a 的代码通过 git commit 保留。建议在 4b 切换时写一个简短的对比笔记（参考格式：`docs/dev-log/2026-07-xx-react-loop-learning.md`），记录：
- 手写版本跑了几个 case、遇到了什么问题
- 切换到 `stopWhen` 后少了多少代码
- 哪些行为是 SDK 做的、哪些是自己控制的

这不是文档任务——是给自己留一个"我当时亲手写过"的证据。
