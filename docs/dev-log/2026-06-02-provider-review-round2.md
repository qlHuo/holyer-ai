# 2026-06-02 — Provider 层第二轮审查：构造参数一致性与空值安全

> 接口设计完整的 Provider 层，在实现细节上仍有三个"看起来没问题，实际会炸"的 bug——两个和 `''` 有关，一个和"忘了传参"有关。

---

## 讨论背景

距离 [初次实现](./2026-06-01-provider-implementation.md) 和 [类型安全审查](./2026-06-02-type-safety-review.md) 仅一天，对 Provider 层进行了第二轮逐文件审查。本轮审查聚焦**构造参数链路**和**边界值安全**，不涉及消息 role 的类型安全问题（第一轮已覆盖）。

审查共发现 7 个问题，其中 2 个是用户率先识别出的设计缺口。

---

## 核心结论

### 1. `models` 构造参数形同虚设

**用户发现**：`factory.ts` 的 `createLLMProvider` 没有传入 `models` 参数，导致三个 Provider 的 `models()` 永远返回各自的 `SUPPORTED_MODELS` 常量。

| case | 审查前代码 | 问题 |
|------|-----------|------|
| `openai` | `new OpenAIProvider({ apiKey, baseUrl })` | 缺 `models` |
| `anthropic` | `new AnthropicProvider({ apiKey })` | 缺 `models` |
| `deepseek` | `new DeepSeekProvider({ apiKey, baseUrl })` | 缺 `models` |

**根因**：`models` 构造参数的**原始设计目的**是让工厂能注入自定义模型列表——比如千问复用 `OpenAIProvider` 时覆盖模型白名单。但工厂实现时忘了传，参数成了死代码。

**修复**：`createLLMProvider` 签名增加 `models?: ModelInfo[]` 参数，三个 case 全部传入。外部调用方可选覆盖，不传则使用 Provider 内置默认值。

```ts
// 修复后
export function createLLMProvider(providerId: string, models?: ModelInfo[]): LLMProvider {
  // ...
  case 'openai':
    return new OpenAIProvider({ apiKey, baseUrl, models })
  case 'anthropic':
    return new AnthropicProvider({ apiKey, baseUrl, models })
  case 'deepseek':
    return new DeepSeekProvider({ apiKey, baseUrl, models })
}
```

### 2. `AnthropicProvider` 缺少 `baseUrl` 支持

**用户发现**：国内模型（如 DeepSeek）开始兼容 Anthropic 格式，但 `AnthropicProvider` 无法配置 `baseUrl`，接入非官方 Anthropic 兼容端点不可行。

**具体缺口**：

| 位置 | 问题 |
|------|------|
| `AnthropicConfig` 接口 | 只有 `apiKey` + `models?`，无 `baseUrl?` |
| `AnthropicProvider` 构造函数 | 未传 `baseURL` 给 `new Anthropic({...})` |
| `factory.ts` | 未读取 `config.anthropicBaseUrl` |
| `nuxt.config.ts` | `anthropicBaseUrl: ''` 已声明但从未被读取（死配置） |

**修复**：
1. `AnthropicConfig` 增加 `baseUrl?: string`
2. 构造函数传 `baseURL: config.baseUrl || 'https://api.anthropic.com'`
3. `factory.ts` 的 anthropic case 传入 `baseUrl: config.anthropicBaseUrl`

### 3. `??` vs `||` 空值陷阱：runtimeConfig 默认值是 `''` 不是 `undefined`

**这是本轮审查发现的最隐蔽的 bug**。

Nuxt `runtimeConfig` 中声明但未在 `.env` 配置的变量，运行时值为 `''`（空字符串），不是 `undefined`。

```ts
// nuxt.config.ts
runtimeConfig: {
  openaiBaseUrl: '',    // 未配置时 → '' 而非 undefined
  deepseekBaseUrl: '',
  anthropicBaseUrl: '',
}
```

三个 Provider 的 `baseUrl` fallback 写法有分歧：

| Provider | 审查前代码 | `''` 时行为 |
|----------|-----------|:--:|
| openai | `baseURL: config.baseUrl` | SDK 收到 `''`，不触发内部默认值 → 请求失败 |
| deepseek | `config.baseUrl ?? 'https://api.deepseek.com'` | `'' ?? default` → `''` → fetch 到 `/chat/completions` → 失败 |
| anthropic | 无此参数 | — |

**关键**：`??`（nullish coalescing）只拦截 `null`/`undefined`，不拦截 `''`。`||`（logical OR）拦截所有 falsy 值（`''`、`0`、`false`、`null`、`undefined`）。

**修复**：三个 Provider 统一使用 `||` 做 fallback：

```ts
// openai.ts
baseURL: config.baseUrl || 'https://api.openai.com/v1'

// deepseek.ts
this.baseUrl = config.baseUrl || 'https://api.deepseek.com'

// anthropic.ts
baseURL: config.baseUrl || 'https://api.anthropic.com'
```

openai.ts 还有一种更简洁的写法 `config.baseUrl || undefined`，利用 SDK 自身默认值。但显式写默认地址更透明——阅读代码时不用翻 SDK 文档就知道请求发到哪。

### 4. 三个 Provider 的 system prompt 处理不一致

**同一个输入，三个 Provider 三个行为**：

| Provider | `options.systemPrompt` | messages 中的 `role: 'system'` | 两者同时存在 |
|----------|----------------------|---------------------------|:--:|
| openai | ✅ 插入首条 | ❌ **静默丢弃** | 只用 systemPrompt |
| anthropic | ✅ 设到 `params.system` | ✅ 提取并合并（`\|\|` fallback） | 只用 systemPrompt |
| deepseek | ✅ 插入首条 | ✅ 原样通过 | 出现**两条** system 消息 |

**统一方案**：三个 Provider 在循环前用同一段逻辑合并 system prompt：

```ts
// 三个 Provider 的 chat() 开头统一加这段
const systemFromMessages = messages
  .filter(m => m.role === 'system')
  .map(m => m.content)
  .join('\n\n')

const systemPrompt = [options.systemPrompt, systemFromMessages]
  .filter(Boolean)
  .join('\n\n') || undefined
```

然后 `switch` 中 `case 'system'` 统一跳过（已在上方合并）。

**效果**：两种传 system prompt 的方式都生效，同时传时自动合并，不丢任何内容。

### 5. 次要问题

| 问题 | 文件 | 修复 |
|------|------|------|
| DeepSeek 模型 `id`/`name` 颠倒 | `deepseek.ts` | `id` 必须是 API 标识符 `deepseek-v4-flash`，`name` 是显示名 `DeepSeek V4 Flash` |
| 注释掉的旧 `as` 代码残留 | `openai.ts` | 删除 6 行死代码 |
| `deepseek.ts` 中 `// case 'system':` 注释残留 | `deepseek.ts` | 删除，已有独立的 `case 'system': break` |

---

## 问题全景

| # | 严重度 | 类别 | 问题 | 发现者 |
|---|:---:|------|------|:---:|
| 1 | 🟡 | 参数链路 | `factory.ts` 未传 `models`，构造参数形同虚设 | 用户 |
| 2 | 🟡 | 参数链路 | `AnthropicProvider` 缺 `baseUrl` 支持 | 用户 |
| 3 | 🔴 | 空值安全 | 空字符串 `baseUrl` 不触发默认值（`??` vs `\|\|`） | 审查 |
| 4 | 🟡 | 一致性 | system prompt 三个 Provider 处理不一致 | 审查 |
| 5 | 🔴 | 数据正确性 | DeepSeek id/name 颠倒 | 审查 |
| 6 | 🟢 | 代码整洁 | 死代码残留 | 审查 |
| 7 | 🟡 | 死配置 | `anthropicBaseUrl` 在 runtimeConfig 中从未被读取 | 审查 |

**Phase 2 相关（本轮识别但暂不修）**：

| 问题 | 位置 | 说明 |
|------|------|------|
| tool 消息 `tool_call_id` 被注释 | `deepseek.ts` | Phase 2 Agent 引入 tool 消息后需取消注释 |
| tool_result 被 `JSON.stringify` | `anthropic.ts` | Anthropic API 要求 content block 格式，非 JSON 字符串 |
| assistant 消息的 `toolCalls` 未传递 | 三个 Provider | 多轮工具调用时上下文断裂 |

---

## 关键洞察

- **`??` 和 `||` 的选择不是风格问题，是数据正确性问题**：Nuxt `runtimeConfig` 的默认值是 `''`，这意味着 `??` 在绝大多数场景下是**错误选择**——只要上游是 runtimeConfig，就必须用 `||`
- **接口设计完整 ≠ 实现完整**：`models` 构造参数、`baseUrl` 支持、system prompt 合并——这些设计都是对的，但在实现细节上被遗漏了。代码审查的价值就是找出"设计已覆盖但实现未跟上"的落差
- **一致性审查需要一个维度一个维度地横切**：`as` vs `switch` 是按 role 维度横切，本轮是按 system prompt 维度横切。两个维度都发现了不一致——说明多 Provider 项目需要刻意维护"横向一致性"，而不能只靠每个 Provider 独立开发
- **"Phase 2 问题暂不修"是一个有效的边界管理**：本轮识别的 7 个问题中，6 个是 Phase 1 范围应修的（已全部修复），3 个是 Phase 2 范围可暂缓的。明确边界避免了过度修复和不够修复的两种极端

---

## 相关文档

- [2026-06-01 Provider 实现记录](./2026-06-01-provider-implementation.md) — 三层架构、`models()` 精选白名单、SSE 解析
- [2026-06-02 类型安全审查](./2026-06-02-type-safety-review.md) — `as` vs `switch` 穷尽性检查、tool 消息映射表
- [2026-06-02 CI/CD 配置](./2026-06-02-cicd-setup.md) — runtimeConfig 类型安全（首次 CI 拦截记录）
- [ADR-009 国内模型 API 兼容性](../decisions/009-model-compatibility.md) — Anthropic vs OpenAI 格式差异
- [架构设计](../../.claude/plan/architecture.md) — 3.1 LLM Provider 抽象层
