# 2026-08-06 — Agent 内容审核拦截的自愈方案

> LLM API 安全过滤是黑盒——不透明的 400，不可知的触发条件。在"没法知道哪条结果有问题"的约束下，用"并行试毒 + 精确剔除 + 渐进降级"换取最大信息保留。

---

## 讨论背景

用户输入"总结今天国内热点新闻"，Agent 调用 `web_search` 获取了 5 条结果。工具结果写入 AgentMemory 后，下一轮 LLM 调用时 DeepSeek API 返回 HTTP 400 `"Content Exists Risk"`——安全审核扫描整个请求体，发现搜索结果中的某条（或某几条）网页文本含敏感内容，直接拒绝推理。用户得不到任何回复。

这不是 LLM 模型的问题（还没进入推理），也不是前端 UI 的问题（错误文案再友好也掩盖不了"空结果"的事实）。本质是**架构缺陷**：工具产出的内容不受控，但会回流给 LLM，而 LLM API 的安全过滤在请求级别一刀切。

---

## 核心内容

### 一、问题定界：为什么不透明

LLM API（DeepSeek / OpenAI 兼容）的内容审核是一个**请求级别的黑盒**：

- 输入：整个 `messages` 数组
- 输出：布尔值（200 放行 / 400 拦截）
- 不提供：哪条消息、哪段文字触发了过滤

这意味着**无法做精确的内容预过滤**——我们写的正则/关键词检测，和 API 内部的判定逻辑是两套系统，不可能完全同步。用正则做前置过滤，要么漏杀（我们认为干净但 API 拦截），要么误杀（我们过滤了但 API 其实不会拦）。

### 二、方案对比

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A：反应式隔离（采用）** | 400 后逐条试毒，只剔除有问题的 | 精确定位，最大保留信息，正常路径零成本 | 出错时多 N 次 API 调用 |
| **B：前置试毒** | 每轮工具执行后都逐条测一遍 | 从源头阻断，不会先失败再重试 | **每轮都多 N 次调用**，延迟翻倍，不可接受 |
| **C：盲截断** | 不管哪条有问题，统一截断到 N 字符 | 简单，零额外 API 调用 | 截到多少安全纯属猜测，信息损失大 |
| **D：关键词预过滤** | 用正则/关键词在工具层过滤 | 零成本 | 和 API 判定不同步，不可靠 |

**选择 A 的关键理由**：99% 的请求不会触发审核（正常路径），不应该为 1% 的异常路径增加延迟和成本。而触发时多出来的 API 调用（N 条结果 = N 次并行试毒，约 500ms）是可接受的。

### 三、实施：试毒 + 渐进降级

#### 3.1 核心流程

```
provider.chat(全部工具结果) → 200 → 正常流（99% 场景，零额外成本）

provider.chat(全部工具结果) → 400
  │
  ├─ Level 1: 并行试毒
  │   每条结果构造最小测试上下文独立发送 →
  │     [user: "OK"] → [assistant(tool_calls)] → [tool: 完整结果]
  │   200 = 干净 ✓ · 400 = 有问题 ✗
  │   只替换有问题的 → 重试（不带 tools）
  │
  ├─ 仍被拒 → Level 2: 全量替换
  │   所有 tool 消息 → "此搜索结果因内容限制不可用"
  │   重试 → 让 LLM 基于自身知识回答
  │
  └─ 仍被拒 → 抛出（用户消息本身的问题，无法自愈）
```

#### 3.2 为什么试毒用 assistant + tool 配对

试毒时如果直接把敏感内容放在 `{role: 'user', content}` 里，和真实场景（内容是 `tool` role）结构不同。API 安全过滤可能对不同 role 采用不同策略——例如 tool 消息更宽松（因为是系统产生的），或者更严格（因为可能是用户注入的）。保持结构一致可降低"测试通过但真实被拦"的误判率。

#### 3.3 为什么重试时不传 tools

避免 LLM 在降级重试中再次调用同一个搜索工具、拿到同样的敏感结果，陷入"搜索 → 拦截 → 降级 → 搜索 → 拦截"的死循环。

#### 3.4 为什么试毒用 maxTokens: 10

不关心回复内容，只关心请求是否被拒。极小的 maxTokens 让 token 消耗几乎为零，同时确保流能正常结束（不会被 API 拒绝过小的 maxTokens 值）。

### 四、Provider 复用 + 流隔离：为什么多次调用不会串话

试毒用的是同一个 Provider 实例（`createLLMProvider()` 只在 chat endpoint 初始化时调用一次），只是多次调 `provider.chat()`。这没问题，但**安全性来自两个独立条件**：

**条件一：Provider 无状态 → 并发安全**

- `chat()` 每次创建独立 HTTP 请求（`fetch()`），不共享任何可变状态
- 底层 `fetch()` 原生支持并发——就像浏览器同时发 5 个 XHR，互不干扰

**条件二：流隔离 → 不会泄露到前端**

这是更关键的保证。每次 `provider.chat()` 返回一个**独立的 `ReadableStream`**：

```
试毒调用：
  stream_1 → testStream.cancel() → 消失，内容不进任何管道

主流程（降级重试后）：
  stream_retry → reader.read() → yield AgentEvent
    → chat endpoint 的 eventStream controller.enqueue()
      → createSSEResponse() → SSE → 前端
```

试毒的流被 cancel 掉，它的内容永远不会进入 `eventStream` 的 ReadableStream，更不会到达 `createSSEResponse` 的 controller。即使并行试毒 100 次，前端也只看到最后那次成功的 `provider.chat()` 通过 `controller.enqueue()` 产出的文本。

**两个条件缺一不可**：Provider 有状态 → 并发崩溃；流不隔离 → 试毒内容串到前端。

另外，**共享 AbortSignal 是特性不是 bug**——用户中断对话时，试毒请求也应该一起取消，避免浪费。

### 五、退化版子 Agent

试毒的调用模式（父级发起独立 LLM 调用、等待结果、基于结果做决策）本质上是**子 Agent 的退化形态**：保留了"独立 LLM 调用"这个最底层能力，但把子 Agent 的自主性（任务理解、工具选择、多轮循环）全部抽掉，退化成一个硬编码的布尔判定。

这个模式可以作为项目未来演进多 Agent 系统的起点——把硬编码的测试 prompt 替换成可配置的任务描述，就是一个真正的子 Agent 调用了。

---

## 关键洞察

- **不透明 API 的应对策略**：面对黑盒过滤，唯一可靠的检测方式是"真的发请求去试"。关键词、正则、截断都是猜测。
- **正常路径零成本是硬约束**：异常处理的代价绝不应该转嫁给正常路径。`isContentFilterError()` 的条件判断是唯一额外开销。
- **并行试毒而非串行**：N 条结果 = N 次请求，串行是 N × 500ms，并行是 ~500ms。`Promise.all` 在这个场景下没有副作用（各请求独立）。
- **试毒的非审核错误保守处理**：网络波动等非审核错误默认保留内容——宁可多留一条可能有问题的，不可误杀一条干净的。

## 代码位置

| 文件 | 函数/方法 | 职责 |
|------|---------|------|
| `server/service/agent/runner.ts` | `isContentFilterError()` | 审核错误识别 |
| `server/service/agent/runner.ts` | `isolateAndFilterToolResults()` | 并行试毒 + 精确替换 |
| `server/service/agent/runner.ts` | `runAgentLoop()` L165-206 | 两级渐进降级循环 |
| `server/service/agent/memory.ts` | `getToolMessages()` | 获取 tool 消息可变引用 |

## 相关文档

- [Agent ReAct 完整流程分析](2026-08-05-agent-react-full-flow.md) — 解释 Agent 循环中工具结果回流的架构
- [网络搜索工具后端选型](2026-08-04-web-search-backend-selection.md) — Tavily 搜索工具的选型过程
- [Phase 2 Agent 系统设计方案](../../.claude/plan/phase2-agent-design.md) — Agent 整体架构决策
- [LLM Provider 开发规则](../../.claude/rules/llm-provider.md) — Provider 接口契约与复用模式
