# ADR-009: 国内模型 API 兼容性调研与统一策略

> 日期：2026-05-31 · 状态：✅ 已采纳

---

## 背景

项目需要支持多 LLM Provider，且用户倾向使用国内模型（DeepSeek、千问、GLM、MiniMax 等）。需要调研国内模型的 API 兼容格局，确定 Provider 抽象层的实现策略和投入。

## 决策

**实现两个适配器覆盖所有模型**：一个 OpenAI 格式适配器覆盖 90% 国内模型，一个 Anthropic 格式适配器覆盖 Claude 全系。不单独为每个模型写 Provider。

---

## 1. 国内模型 API 兼容格局

### 核心结论：OpenAI 兼容是事实标准

```
                        OpenAI 兼容格式              Anthropic 原生格式
                    ─────────────────────        ──────────────────────

OpenAI GPT-4o/4.1         ✅ 原生                     ❌
Anthropic Claude          ❌（有独立格式）               ✅ 原生

DeepSeek V3/R1/R2         ✅ 完全兼容                   ❌
通义千问 (Qwen)            ✅ 阿里百炼平台兼容             ❌
智谱 GLM-4                ✅ 完全兼容                   ❌
月之暗面 Kimi (Moonshot)   ✅ 完全兼容                   ❌
MiniMax (abab)            ✅ 兼容                       ❌
百川 (Baichuan)           ✅ 兼容                       ❌
字节豆包 (Doubao)          ✅ 兼容（火山引擎）             ❌
讯飞星火 (Spark)           ⚠️ 有兼容层（不完全）           ❌

Claude 全系               ⚠️ 非原生                     ✅ 原生
```

### 逐家分析

| 厂商 | 模型 | API 端点格式 | 与标准 OpenAI 的差异 |
|------|------|------------|---------------------|
| **DeepSeek** | V3, R1, R2 | OpenAI 100% 兼容 | 几乎无差异，换 `baseURL` + `apiKey` 即用 |
| **阿里百炼（通义千问）** | Qwen3-Max, Qwen-Plus | OpenAI 兼容 | ⚠️ 某些版本 cumulative 返回，需做减法提取增量；thinking 过程字段名可能不同 |
| **智谱（GLM）** | GLM-4-Plus | OpenAI 兼容 | 几乎无差异；工具调用 `tool_calls` 的 `index` 处理有极微差异 |
| **月之暗面（Kimi）** | Moonshot-v1 | OpenAI 兼容 | 几乎无差异 |
| **MiniMax** | abab7 | OpenAI 兼容 | 几乎无差异 |
| **字节（豆包）** | Doubao-1.5-pro | OpenAI 兼容（火山引擎） | streaming 的 `finish_reason` 返回时机有差异 |
| **讯飞星火** | Spark 4.0 | ⚠️ 有 OpenAI 兼容层但非 100% | 最大差异：参数名略有不同，需要额外适配逻辑 |

---

## 2. 两种流式模式：Delta vs Cumulative

### Delta 模式（增量传输）

```
chunk 1: "你"
chunk 2: "好"
chunk 3: "吗"
chunk 4: "？"

前端拼接: "" → "你" → "你好" → "你好吗" → "你好吗？"
```

| 使用此模式的 Provider | 原始格式关键字段 |
|----------------------|-----------------|
| OpenAI | `choices[0].delta.content` |
| DeepSeek | `choices[0].delta.content`（兼容 OpenAI） |
| Anthropic | `delta.text`（字段名不同，但语义也是 delta） |
| 智谱 GLM | `choices[0].delta.content` |
| Kimi | `choices[0].delta.content` |

### Cumulative 模式（累积传输）

```
chunk 1: "你"
chunk 2: "你好"
chunk 3: "你好吗"
chunk 4: "你好吗？"

前端直接替换: 拿最新 chunk 的 content 覆盖显示
```

| 使用此模式的 Provider | 说明 |
|----------------------|------|
| 通义千问（某些 API 版本） | 每个 chunk 携带**当前已生成的完整文本** |

### 模式对比

| 维度 | Delta | Cumulative |
|------|:-----:|:----------:|
| 带宽 | ✅ 省（每次只传新 token） | ❌ 重复传输已生成内容 |
| 前端实现复杂度 | 稍多（需维护拼接 buffer） | ✅ 简单（直接覆盖） |
| 网络抖动容错 | ❌ 丢一个 chunk 文本就缺一段 | ✅ 丢一个 chunk 下一个补上 |
| **Token 级流式渲染** | ✅ 天然支持逐字出现 | ❌ 本质上是整句替换 |
| **市场主流** | ✅ 绝对主流 | 少数 |

### 统一策略

**Provider 抽象层统一输出 Delta 模式**。对于 Cumulative 模式的千问，在其 Provider 内部做转换：

```ts
// 千问 Provider 内部逻辑
let previousContent = ''
function extractDelta(cumulativeContent: string): string {
  const delta = cumulativeContent.slice(previousContent.length)
  previousContent = cumulativeContent
  return delta  // 只产出增量
}
```

这样上层（`/api/chat`、Agent Runtime）永远只看到 Delta，不关心底层是哪种模式。

---

## 3. OpenAI vs Anthropic 格式核心差异

### 差异总览

| 维度 | OpenAI 格式 | Anthropic 格式 |
|------|------------|---------------|
| **首个 chunk** | 只包含 `role: "assistant"`，无内容 | 无空 role chunk，直接出内容 |
| **内容字段** | `choices[0].delta.content` | `delta.text` |
| **SSE 行格式** | `data: {...}\n\n` | `event: content_block_delta\ndata: {...}\n\n` |
| **结束标记** | `choices[0].finish_reason: "stop"` | `type: "message_stop"` |
| **System Prompt** | `messages[0]` 中 `role: "system"` | 独立 `system` 字段（不在 messages 里） |
| **工具调用参数** | 分片 JSON token（`"{\"na"` → `"me\""` → `":\"张"` → `"三\"}"`） | 累积 JSON 前缀（`{"name"` → `{"name":"张"` → `{"name":"张三"}`） |
| **Thinking 过程** | 无原生支持（第三方兼容方案） | ✅ 原生 `thinking` 事件（Claude 4 专有） |
| **Usage 信息** | 首/尾 chunk 携带 | 每个 `message_stop` 携带 |

### 差异 1：System Prompt 位置

```ts
// OpenAI / DeepSeek / 千问 / GLM / ... 全部这样
const openaiBody = {
  messages: [
    { role: 'system', content: '你是代码助手' },  // system 是 messages 的一条
    { role: 'user',   content: '帮我审查代码' }
  ]
}

// Anthropic 独有
const anthropicBody = {
  system: '你是代码助手',  // 独立字段，不在 messages 数组里！
  messages: [
    { role: 'user', content: '帮我审查代码' }
  ]
}
```

**影响**：`LLMProvider.chat()` 接口需要定义 `systemPrompt` 独立参数，而不是混在 messages 里。OpenAI 适配器内部把 system 压入 messages 首条，Anthropic 适配器内部放到独立字段。

### 差异 2：工具调用参数的流式传输

OpenAI 的工具调用参数是**分片 JSON token**：

```
chunk 1: tool_calls[0].function.arguments = '{"na'
chunk 2: tool_calls[0].function.arguments = 'me"'
chunk 3: tool_calls[0].function.arguments = ':"张'
chunk 4: tool_calls[0].function.arguments = '三"}'
// 前端拼起来才是完整的 {"name":"张三"}
```

Anthropic 的工具调用参数是**完整 JSON 累积**：

```
chunk 1: input_json_delta = '{"name"'
chunk 2: input_json_delta = '{"name":"张'
chunk 3: input_json_delta = '{"name":"张三"}'
// 每个 chunk 都是完整的 JSON 前缀
```

**影响**：Agent Runtime 需要统一的工具调用格式。不管底层是分片还是累积，Provider 层必须产出标准化的 `ToolCall` 对象（完整 JSON）。

---

## 4. Provider 抽象层设计

### 接口定义

```ts
// server/services/llm/types.ts
interface LLMProvider {
  id: string
  chat(messages: Message[], options: ChatOptions): Promise<ReadableStream<string>>
  models(): ModelInfo[]
}

interface ChatOptions {
  model: string
  temperature?: number
  maxTokens?: number
  tools?: ToolDefinition[]
  systemPrompt?: string  // 独立参数，不在 messages 里
}
```

### 实现文件与覆盖范围

```
server/services/llm/
├── types.ts          ← LLMProvider 接口 + ChatOptions + ToolDefinition
├── factory.ts        ← 按 provider ID 返回实例（一行配置接入新模型）
├── openai.ts         ← OpenAI 格式适配器 → 覆盖 90% 国内模型
└── anthropic.ts      ← Anthropic 格式适配器 → 覆盖 Claude 全系
```

### 实际接入国内模型的方式

大部分国内模型无需单独写 Provider，只需在 `factory.ts` 配置：

```ts
// DeepSeek — 复用 OpenAI 适配器，只换配置
case 'deepseek':
  return new OpenAIProvider({
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: env.DEEPSEEK_API_KEY
  })

// 千问 — 复用 OpenAI 适配器，加上 cumulative→delta 转换
case 'qwen':
  return new OpenAIProvider({
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: env.QWEN_API_KEY,
    streamingMode: 'cumulative'  // 标记需要做减法
  })

// 智谱 GLM — 复用 OpenAI 适配器，只换配置
case 'glm':
  return new OpenAIProvider({
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: env.GLM_API_KEY
  })
```

---

## 5. 实现工作量

| 工作 | 预估工时 | 复用度 |
|------|---------|:---:|
| `types.ts`（接口定义） | 30 分钟 | 全部复用 |
| `openai.ts`（OpenAI 格式适配器） | 2 小时 | **覆盖 90% 国内模型** |
| `anthropic.ts`（Anthropic 格式适配器） | 2 小时 | 只服务 Claude |
| `factory.ts`（注册表） | 15 分钟 | - |
| **总计** | **~5 小时** | |

**核心结论**：只需两个适配器，覆盖全部模型。接入新模型是一个配置项，不是一次开发。

---

## 相关文档

- [ADR-008: Vercel AI SDK 不集成决策](008-vercel-ai-sdk.md)
- [2026-05-31 流式架构深层讨论](../dev-log/2026-05-31-streaming-architecture.md)
- [架构设计](../../.claude/plan/architecture.md) — 3.1 LLM Provider 抽象层
