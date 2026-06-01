# 2026-06-01 — LLM Provider 层实现记录：设计决策与踩坑

> Provider 层的真正价值不在"能调通 API"，而在"把差异关在门内，出门都是同一种流"。

---

## 讨论背景

Phase 1.2 LLM Provider 抽象层于今天正式编写完毕。6 个文件从共享类型到工厂函数，按"类型先行"原则逐层构建。在编写和审查过程中，围绕 `models()` 硬编码、Provider 三层架构、SSE 字节流解析进行了深度讨论。

---

## 核心结论

### 1. 三层 Provider 架构

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│   上层代码（API 路由 / Agent / Skills）                    │
│                                                          │
│   只知道：chat(messages, options) → ReadableStream<string> │
│                                                          │
│   ═══════════════════ 接口边界 ═══════════════════════════ │
│                                                          │
│   OpenAI：SDK → AsyncIterable → for await → enqueue       │
│   Claude：SDK → AsyncIterable → for await → enqueue       │
│   DeepSeek：fetch → 手动SSE解析 → 逐行parse → enqueue     │
│                                                          │
│   每个 Provider 把自己的差异关在门内，                      │
│   出门时都变成了 ReadableStream<string>                    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**每一层的职责**：

| 层 | 文件 | 职责 |
|----|------|------|
| **API 路由** | `server/api/test.get.ts` | 拿到 Provider → 调 `chat()` → 消费流 → 返回响应 |
| **工厂** | `server/services/llm/factory.ts` | 把字符串 ID 变成实例。路由不关心 new 哪个类 |
| **Provider** | `openai.ts` / `anthropic.ts` / `deepseek.ts` | 消化各自的 API 差异，统一输出 `ReadableStream<string>` |

**为什么这样设计**：

上层代码不需要知道它用的是 OpenAI SDK 还是裸 `fetch`。它只看到 `chat(messages, options)` 和 `ReadableStream<string>`。这保证了：

- 加新模型时，API 路由和 UI 零改动
- Agent Runtime（Phase 2）拿到的东西和普通对话完全一样
- 每个 Provider 可以独立修改内部实现，不影响外部

### 2. `models()` 为什么硬编码——“精选白名单”

**问题**：为什么不在 Provider 里动态拉取 API 的模型列表？

**答案**：不是所有 Provider 都有 `/models` API，即使有，返回的结果也不能直接给用户。

| Provider | 有模型列表 API？ | 返回什么？ |
|----------|:---:|------|
| OpenAI | ✅ | 几十个模型（含已弃用、微调、completion 模型） |
| Anthropic | ❌ | 无公开端点 |
| DeepSeek | ❌ | 无公开端点 |

直接暴露给用户是坏的体验——用户面对几十个模型名不知道该选哪个。

**`SUPPORTED_MODELS` 的本质**：不是"偷懒没做动态拉取"，而是**人工精选**——"这些是我验证过的、推荐的、有 API Key 的模型，放心用。"

**`models()` 方法的作用**：多态。前端切换 Provider 时只调同一个方法名，拿到什么模型列表就渲染什么：

```ts
// 前端不需要知道 Provider 内部逻辑
const models = createLLMProvider('openai').models()    // GPT 列表
const models = createLLMProvider('deepseek').models()  // DeepSeek 列表
```

### 3. OpenAI 格式复用的关键设计：constructor 注入 `models`

**问题**：千问用 `OpenAIProvider({ baseURL: '...' })` 接入，但 `models()` 返回的是 OpenAI 的模型列表。怎么解决？

**方案**：`models` 作为构造参数，允许外部覆盖：

```ts
interface OpenAIConfig {
  apiKey: string
  baseURL?: string
  models?: ModelInfo[]  // 不传就用 OpenAI 默认，传了就用自己的
}
```

接入千问时：

```ts
new OpenAIProvider({
  apiKey: config.qwenApiKey,
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  models: [
    { id: 'qwen-max', name: '千问 Max', supportsTools: true },
    { id: 'qwen-plus', name: '千问 Plus', supportsTools: true },
  ],
})
```

**接入新模型的完整公式** — 三要素：

| 配置项 | 作用 | 示例（千问） |
|--------|------|-------------|
| `baseURL` | 告诉 `chat()` 往哪发请求 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `apiKey` | 鉴权 | `config.qwenApiKey` |
| `models` | 告诉前端的模型白名单 | `[{ id: 'qwen-max', ... }]` |

三个都是构造参数，不写新文件。只有 Anthropic 这种格式完全不同的才需要单独写类。

### 4. SSE 字节流手动解析（DeepSeek Provider）

DeepSeek 用纯 `fetch` 实现，不依赖任何 SDK。这涉及手动解析 SSE 字节流：

```
ReadableStream<Uint8Array>        ← response.body (fetch 返回的原始字节流)
        │  reader.read()
        ▼
Uint8Array                        ← 每次 read() 拿到的字节块
        │  decoder.decode(value, { stream: true })
        ▼
string                            ← 解码后的文本
        │  .split('\n')
        ▼
string[] (逐行)                    ← "data: {...}" / "[DONE]" / 空行
        │  .startsWith('data: ')
        ▼
JSON.parse(data.slice(6))         ← 去掉 "data: " 前缀后解析 JSON
        │  .choices[0].delta.content
        ▼
string token                      ← 纯文本 token，enqueue 到 ReadableStream
```

**两个关键细节**：

① **`TextDecoder.decode(value, { stream: true })`** — 多字节字符（中文、emoji）在 UTF-8 中占 3-4 字节。如果 chunk 边界恰好切在一个字中间，`stream: true` 让解码器缓存残缺字节，等下一个 chunk 到了再拼接。不加这个参数，中文会在 chunk 边界变成 `�`。

② **buffer 管理** — `buffer.split('\n')` 后 `.pop()` 取回最后一行。因为最后一个 chunk 的最后一行可能是不完整的（`data: {"choices"...` 还没收到 `}\n\n`），需要留在 buffer 里等下一个 chunk 来拼接。

---

## 踩坑记录

| 坑 | 现象 | 原因 | 修复 |
|----|------|------|------|
| **DeepSeek 404** | API 调用返回 404 Not Found | `baseUrl` 默认值写成了 `https://api.deepseek.com`，拼接后是 `/chat/completions`，缺了 `/v1` 段 | 改为 `https://api.deepseek.com/v1` |
| **模型名无效** | DeepSeek 返回 model not found 错误 | 测试代码中用了不存在的 `deepseek-v4-flash`，真实模型名是 `deepseek-chat` | 对齐 API 文档中的模型 ID |

---

## 关键洞察

- **Provider 抽象层不等于"调通 API"**：OpenAI 用 SDK、DeepSeek 用 fetch、Claude 用独立格式——三种实现方式差异巨大，但接口层面完全统一。这是封装的力量，也是接口设计的关键价值
- **`chat()` 返回 `ReadableStream<string>` 不是随意选的**：这个设计让 Phase 2 的 Agent Runtime 可以直接消费 Provider 的输出，无需任何适配。Agent 不需要知道自己调的是哪个模型
- **硬编码不是技术债务**：`SUPPORTED_MODELS` 的"精选白名单"比动态拉取更有价值——它过滤噪音，给用户推荐经过验证的模型。新模型上线改一行常量，成本几乎为零
- **`baseURL + apiKey + models` 三个构造参数 = 接入任何 OpenAI 兼容模型**：90% 的国内模型不需要新类，一个 `OpenAIProvider` 配上不同的构造参数就够了。节省的开发时间远超过花在架构设计上的时间

---

## 相关文档

- [开发思维转变](./2026-05-31-mindset.md) — 为什么必须后端优先
- [流式架构深层讨论](./2026-05-31-streaming-architecture.md) — 四段流式模型
- [ADR-008: Vercel AI SDK 不集成](../decisions/008-vercel-ai-sdk.md)
- [ADR-009: 国内模型 API 兼容性](../decisions/009-model-compatibility.md)
- [项目初始化完整指南](./2026-05-31-scaffold-guide.md) — Phase 1.2 操作步骤
- [架构设计](../../.claude/plan/architecture.md) — 3.1 LLM Provider 抽象层
- [2026-06-02 类型安全审查](./2026-06-02-type-safety-review.md) — `as` 断言 vs `switch` 模式
- [实施路线图](../../.claude/plan/roadmap.md)
