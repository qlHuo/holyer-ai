---
paths:
  - "server/service/llm/**"
  - "shared/types/provider.ts"
description: LLM Provider 开发规范 — 接口契约、工厂注册、流式适配、配置命名
---

# LLM Provider 开发规则

## 何时应用此规则

- 在 `server/service/llm/` 下新增或修改 Provider 文件
- 新增模型提供商（如 Grok、千问、GLM、Kimi 等）
- 修改 `LLMProvider` 接口或 `ChatOptions` 类型
- 设置 Provider 的 API Key 或 Base URL 时
- Provider 的流式输出格式与现有实现不一致时

## 接口契约

所有 Provider 必须实现 `LLMProvider` 接口（[types.ts](../../server/service/llm/types.ts)

```ts
interface LLMProvider {
  readonly id: string
  chat(messages: Message[], options: ChatOptions): Promise<ReadableStream<string>>
  models(): ModelInfo[]
}
```

**关键约束**：
- `chat()` 返回 `ReadableStream<string>` —— 纯文本 token 流，不得返回完整 Response 对象
- 上层（SSE 工具 / API 路由）不关心底层是 OpenAI SSE 还是 Anthropic SSE，只消费文本流
- `ChatOptions.signal` 用于取消请求，**必须**传给底层的 `fetch()` 调用

## 工厂注册模式

新增 Provider 三步走（[factory.ts](../../server/service/llm/factory.ts)）：

```ts
// 1. 创建 Provider 类文件：server/service/llm/<name>.ts
// 2. 在 factory.ts 的 switch 中加一个 case（TypeScript 会检查穷尽性）
// 3. 在 nuxt.config.ts 的 runtimeConfig 中声明环境变量
```

**Factory 使用 `switch` 而非 `Map`** 的原因：TypeScript 的 `switch` 穷尽性检查让新增 Provider 时必须处理 factory，不留遗漏路径。

## 配置命名规范

环境变量遵循统一命名：`NUXT_<PROVIDER>_API_KEY`、`NUXT_<PROVIDER>_BASE_URL`

```ts
// ✅ 正确：通过 useRuntimeConfig() 获取，不直读 process.env
const config = useRuntimeConfig()
const apiKey = config.openaiApiKey

// ❌ 错误：直读 process.env（Edge Runtime 下不可靠）
const apiKey = process.env.OPENAI_API_KEY
```

## 流式适配

每个 Provider 的底层 API 流式格式不同（OpenAI 用 `data: {...}\n\n`，Anthropic 用 Server-Sent Events 流），但必须**在 Provider 内部**消化差异：

```
Provider 内部：
  底层 API SSE 字节流 → TextDecoder → JSON 解析 → extract token → controller.enqueue(token)

Provider 外部（调用方）：
  const stream = await provider.chat(messages, options)
  // stream 就是纯文本 token 流，直接用
```

## 相关文档

执行新增 Provider 的任务前，先检索以下文档了解背景：
- [ADR-008](../../docs/decisions/008-vercel-ai-sdk.md) — 为什么不集成 Vercel AI SDK
- [ADR-009](../../docs/decisions/009-model-compatibility.md) — 国内模型兼容性策略（OpenAI 格式复用公式）
- [provider-implementation](../../docs/dev-log/2026-06-01-provider-implementation.md) — 三层架构详解、SSE 字节流解析
- [type-safety-review](../../docs/dev-log/2026-06-02-type-safety-review.md) — `as` 断言 vs `switch` 穷尽性检查
