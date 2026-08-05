# 2026-08-04 — 网络搜索工具后端选型：从 Brave 到 Tavily 的踩坑之路

> "免费、无需注册、稳定可靠"的搜索 API 不存在——但 Tavily keyless 模式是最接近的答案。

---

## 讨论背景

Phase 2 Agent 工具系统已有 `calculator`、`current_time`、`web_fetch` 三个工具，`web_search` 是第四个。最初实现基于 Brave Search API，但 2026 年 2 月 Brave 取消了免费套餐（改为 $5/月赠金 + 强制绑卡），方案不可持续。

核心约束：Edge Runtime 兼容（纯 `fetch()`）、零成本（个人项目）、国内可用。

---

## 核心内容

### 搜索后端调研：4 次尝试、3 次失败

#### 尝试 1：Brave Search API → 被价格劝退

原始实现。API 设计良好，JSON 返回，但**2026 年 2 月起已无免费套餐**——注册即需绑信用卡，仅 $5 月赠金（约 1000 次查询），超出即扣费且无消费上限。

#### 尝试 2：DuckDuckGo HTML 抓取 → 被 CAPTCHA 拦截

原理：fetch `html.duckduckgo.com/html/?q=...`（DDG 的非 JS 版搜索），正则解析 HTML 中的 `result__a`、`result__snippet` 提取结果。

```
GET https://html.duckduckgo.com/html/?q=TypeScript
  → 返回纯 HTML，包含 class="result results_links..." 的结果块
  → 正则 split + 两次提取（title/URL + snippet）
  → cleanUrl() 解包 DDG 的 uddg 重定向包装
```

首次请求能正常返回结果，但**连续多次请求后触发 DDG 的机器人检测**（`anomaly.js?cc=botnet`），页面变为：

```html
<div class="anomaly-modal__description">
  Please complete the following challenge to confirm 
  this search was made by a human.
</div>
```

**结论：HTML 抓取这条路本质上不可靠。** 不是 DDG 的问题——所有搜索引擎都反爬（百度最严、Google 次之、Bing 中等、DDG 相对宽松但仍有检测）。

#### 尝试 3：SearXNG 公共实例 → 被限流 429

SearXNG 是开源聚合搜索引擎，对外的 JSON API 格式简单：

```
GET /search?q=test&format=json
→ { "results": [{ "title": "...", "url": "...", "content": "..." }] }
```

实测 4 个公共实例：仅 `searx.be` 可用（HTTP 200），其余返回 429 限流。公共实例不可控——随时被薅到限流。

#### 尝试 4：Tavily API ✅ 最终方案

Tavily 是面向 AI Agent 的搜索 API。关键优势：

| 维度 | Tavily | 其他方案 |
|------|--------|---------|
| 免注册使用 | ✅ keyless 模式 | ❌ 均需 API Key |
| 免费额度 | keyless 限频 / 注册 1000 次/月 | Brave $5/月赠金 |
| 绑卡 | ❌ 不需要 | Brave ✅ |
| 返回格式 | 结构化 JSON + AI 摘要 | — |
| 反爬 | ❌ 正式 API | DDG/百度/Google ✅ |

**Keyless 模式的实现细节**：

```ts
// 不配 Key → keyless 模式，需要特殊 Header
headers['X-Tavily-Access-Mode'] = 'keyless'

// 配了 Key → 标准 Bearer 认证
headers['Authorization'] = `Bearer ${apiKey}`

// POST https://api.tavily.com/search
// Body: { query, search_depth: "advanced", max_results: 5, include_answer: true }
```

**Keyless 模式的两个限制**：
1. `include_answer` 始终返回 `null`（AI 摘要需要注册后才有）
2. 限频较严，高频使用建议注册免费 Key

### 日期感知修复

LLM 在搜索时不知道"今天"是哪天（训练数据有截止日期），导致搜索查询出现错误年份：

```
用户："总结今天国内热点新闻"
  → LLM 不知道"今天"
  → 调 web_search("今日国内热点新闻 2025年")  ← 年份错
  → 重来一遍，浪费一轮 ReAct 迭代
```

修复方案：在 system prompt 中注入当前日期（[chat/index.post.ts](../../server/api/chat/index.post.ts) L117-L120）：

```ts
const dateContext = `## 当前时间
今天是 ${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日
（周${...}），当前时间是 ${HH}:${mm}（北京时间 UTC+8）。
搜索实时信息时，请使用上述日期作为参考，不要使用过期的年份。`
```

这比让 LLM 调用 `current_time` 工具更直接——日期不应是"需要主动查询的信息"，而是基本上下文。

---

## 关键洞察

1. **"免费搜索 API"是一个三角不可能**：免费 × 稳定 × 无需注册——三者最多满足两个。Tavily keyless 用"限频"换取了"免费 + 免注册"。
2. **HTML 抓取不是技术问题，是博弈问题**：正则解析 HTML 技术上可行，但搜索引擎的反爬系统是持续进化的，你今天能抓明天就可能被封。
3. **`web_search` 和 `web_fetch` 是配对使用的**：搜索负责"找到 URL"，抓取负责"读取内容"。单有 `web_fetch` 没用——LLM 不知道去哪找。
4. **System prompt 中的日期比工具调用更高效**：LLM 不应该为"现在是几月"这种基本信息浪费一轮工具调用。

## 涉及文件

| 文件 | 变更 |
|------|------|
| [web-search.ts](../../server/service/agent/tools/builtin/web-search.ts) | 完全重写：Brave API → Tavily API（keyless + key 双模式） |
| [nuxt.config.ts](../../nuxt.config.ts) | `braveSearchApiKey` → `tavilyApiKey`（可选） |
| [index.post.ts](../../server/api/chat/index.post.ts) | 新增 `dateContext` 注入当前日期到 system prompt |

## 相关文档

- [Agent 工具系统实现详解](2026-07-29-agent-tool-system-implementation.md) — 工具注册、执行、SSE 事件全链路
- [Phase 2 Agent 设计](../../.claude/plan/phase2-agent-design.md) — 工具系统架构决策
