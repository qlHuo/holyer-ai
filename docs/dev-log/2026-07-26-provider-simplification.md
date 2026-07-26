# 2026-07-26 — Provider 维度移除全栈实施

> 实际实施比 Phase 2 设计走得更远：设计只计划精简 Factory + 删除 Anthropic，实施中进一步发现 `provider` 这个维度本身就不需要存在。

---

## 讨论背景

Phase 2 设计方案（[phase2-agent-design.md](../../.claude/plan/phase2-agent-design.md)）中规划了 Provider 层精简：删除 `anthropic.ts`，DeepSeek 复用 `OpenAIProvider`。方案假设保留 `provider` 作为路由键（`createLLMProvider('deepseek')` vs `createLLMProvider('openai')`）。

实施时发现一个更根本的问题：**既然所有 Provider 都走同一个 `OpenAIProvider` 实现，`provider` 字段就是纯粹的冗余数据**——它不在任何分支逻辑中使用，只增加了全栈各层的维护负担。

---

## 核心内容

### 实施范围：21 个文件，净删 259 行

改动分五个维度：

#### 1. 环境变量统一（nuxt.config.ts）

```
之前：6 个 per-provider 变量
  NUXT_OPENAI_API_KEY, NUXT_OPENAI_BASE_URL
  NUXT_ANTHROPIC_API_KEY, NUXT_ANTHROPIC_BASE_URL
  NUXT_DEEPSEEK_API_KEY, NUXT_DEEPSEEK_BASE_URL

之后：2 个统一变量
  NUXT_MODEL_API_KEY, NUXT_MODEL_BASE_URL
```

切换模型厂商 = 改 `NUXT_MODEL_BASE_URL` 的值。DeepSeek → `https://api.deepseek.com/v1`，OpenAI → `https://api.openai.com/v1`。

#### 2. Factory 无参化（server/service/llm/factory.ts）

```ts
// 之前
export function createLLMProvider(providerId: string, models?: ModelInfo[]): LLMProvider {
  switch (providerId) {
    case 'openai':   return new OpenAIProvider({...})
    case 'deepseek': return new DeepSeekProvider({...})
    case 'anthropic': return new AnthropicProvider({...})
  }
}

// 之后
export function createLLMProvider(): LLMProvider {
  const config = useRuntimeConfig()
  return new OpenAIProvider({
    apiKey: config.modelApiKey,
    baseUrl: config.modelBaseUrl,
    models: MODELS || []
  })
}
```

`deepseek.ts` 保留在代码库中但不再被引用——作为手动 SSE 解析的学习参考。

#### 3. DB Schema 简化（server/db/schema.ts）

`conversations` 表删除 `provider` 列。这是**不可逆的 Schema 变更**——生成的新迁移文件 `0000_tricky_sister_grimm.sql` 直接 CREATE TABLE 无 provider 列。

> ⚠️ 如果生产库已有带 `provider` 列的数据，需要用 `drizzle-kit generate` 生成 ALTER TABLE 迁移而非 `drizzle-kit push`。

#### 4. 全栈类型对齐

`provider` 字段从以下所有位置移除：
- Zod Schema（`server/api/chat/schema.ts`、`server/api/conversations/schema.ts`）
- Service 层类型（`CreateConversationInput`）
- 共享类型（`ConversationDetail`、`ConversationListItem`、`ConversationInput`）
- API 请求体（`ChatRequest`）
- 前端 API 封装（`app/api/conversations.ts`）
- 前端 Store（`chat.store.ts`）

#### 5. 前端 UI 简化（ChatModelSelector.vue + providers.ts → models.ts）

- 删除 `app/constants/providers.ts`（Provider→Model 二级分组结构）
- 新建 `app/constants/models.ts`（扁平模型列表）
- UI 从 "Provider 下拉 + / + Model 下拉" 简化为单个 Model 下拉

当前 `models.ts` 仅列出 2 个 DeepSeek 模型。后续通过 `NUXT_MODEL_BASE_URL` 切换到 OpenAI 时，只需替换模型列表即可——不需要改任何组件代码。

---

## 关键洞察

1. **设计是渐进的，实施可以一步到位**：Phase 2 设计文档分了两步——先精简 Factory，保留 provider 路由。实际写代码时发现保留 provider 路由没有意义（没有分支逻辑需要它），于是一步到位全链路移除。

2. **"provider"曾是必要的，现在不是**：在 ADR-009（2026-05-31）时期，项目有 3 个异构 Provider（OpenAI SDK、Anthropic SDK、手动 fetch），`provider` 字段承担了路由职责。当 3 个异构实现收敛为 1 个后，它退化为冗余元数据。

3. **环境变量是新的切换点**：以前通过前端 UI 选 Provider + 选 Model 两步，现在只需选 Model。厂商切换从"运行时选择"变为"部署时配置"——这对个人项目是合理的，因为同一时间只会用一个厂商的 API。

4. **发现一个 bug**：`factory.ts` 中的错误提示仍引用旧变量名 `NUXT_OPENAI_API_KEY`，实际变量已改为 `NUXT_MODEL_API_KEY`。用户按提示配置会配错变量名，导致一直报错。

---

## 相关文档

- [ADR-009: 国内模型 API 兼容性调研与统一策略](../decisions/009-model-compatibility.md) — 本次实施的架构依据，已追加第 6 节记录演进
- [Phase 2 Agent 系统设计方案](../../.claude/plan/phase2-agent-design.md) — 三、Provider 层精简（设计阶段）
- [2026-06-01 Provider 层实现记录](2026-06-01-provider-implementation.md) — 原始三层架构实现
- [2026-06-02 Provider 第二轮审查](2026-06-02-provider-review-round2.md) — 构造参数一致性讨论
