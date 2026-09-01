# 2026-09-01 — Cloudflare Workers subrequest 超限：Agent 流式增量写入的代价

> 核心洞察：报错表面是「update messages 失败」，真正根因是 Cloudflare 免费计划的 50 个 subrequest 配额被耗尽——每 200 字符写一次 DB 的增量策略，在 RAG 长回答下轻松打爆配额。

---

## 讨论背景

阶段 A 上线 Neon 后，线上向 RAG 知识库提问，前端收到 SSE error：

```
Failed query: update "messages" set "content" = $1 where "messages"."id" = $2
```

排查走过弯路：先怀疑内容含非法字符（NUL / 控制字符），加了 `sanitizeDbText` 清洗，部署后仍报错。给 catch 块补上 `error.cause` 后才拿到真实错误：

```
Error connecting to database: Error: Too many subrequests by single Worker invocation.
```

## 核心内容

### 1. 真实根因：Cloudflare subrequest 配额耗尽

**先厘清 subrequest 是什么**：后端代码跑在 Cloudflare 边缘服务器，凡是代码对外发起一次 HTTP 请求，就记一次 subrequest。注意两点——

- 统计的是「总共发起了多少次 HTTP 请求」，不是「调用了几个不同接口」；同一接口调多次就是多次
- **数据库也在外部**：Neon 不在 Cloudflare 内部、走 HTTPS，所以每次读/写数据库都各算一次 subrequest

Cloudflare Workers **免费计划限制单次 invocation 最多 50 个外部 subrequest**（付费 1000）。而 `neon-http` 驱动的**每次 DB 查询都是一个外部 fetch subrequest**。

一次 RAG 对话的 subrequest 账本：

| 操作 | subrequest 数 |
|------|:---:|
| 用户消息落库（insert + update conversations） | 2 |
| 每轮 LLM 调用 | 1 |
| embedding（query 向量化） | 1 |
| 向量检索（searchChunks） | 1 |
| 工具消息落库（assistant + tool） | 2 |
| 最终回答占位 insert | 1 |
| **每 200 字符增量 updateMessage** | **N（长回答 N 大）** |

「每 200 字符增量写入」是最大头：3000 字回答 = 15 次，6000 字 = 30 次，叠加其他操作轻松突破 50。报错的 `update messages` 只是压垮骆驼的最后一根稻草。

### 2. 为什么「每 200 字符增量写入」在 Agent 场景是错的

这是 Phase 1 普通聊天的策略（`content += delta` 线性增长，增量 UPDATE 简单）。但 ADR-014 已明确：Agent 场景采用**一次性写入**（ReAct 循环快、实际影响低）。代码却沿用了 Phase 1 的增量 flush，在 RAG 长回答下放大成 subrequest 风暴。

### 3. 修复：阈值放大（200 → 2000），增量写入但降低频率

第一版尝试「一次性写入」（回归 ADR-014）：删除增量 flush，只在流结束写一次，subrequest 降到 ~2 次。但实测发现新问题——**流式输出中刷新页面会导致最终回复缺失 / 残留空消息**（占位消息「首次 text 才 insert」，刷新触发 abort 后 `AbortError` 被 catch 提前 return，跳过最终落库）。

最终方案：**保留增量写入，但把阈值从 200 字符放大到 2000 字符**。既把 subrequest 从 ~15~30 次降到 ~3 次（2000 字 ≈ 1~2 分钟生成量），又保留刷新保护（最多丢最后 2000 字，而非整篇）。

| | 每 200 字增量 | 一次性写入 | 每 2000 字增量（最终） |
|---|---|---|---|
| 6000 字回答写几次 | 30 | 1 | 3 |
| subrequest 是否超限 | 超 ❌ | 安全 ✅ | 安全 ✅ |
| 刷新丢多少 | <200 字 | 整篇 ❌ | <2000 字 ✅ |

关键澄清：**「写入」不影响用户看到的打字机流式效果**——流式靠 SSE 实时推给浏览器渲染，与写不写数据库是两回事。写入只决定「刷新页面后能否看到这条回答」。

再加一层兜底：**中断兜底写入**——把 `contentBuffer`/`finalMsgId` 提升到 catch 作用域，abort（刷新/断开）时把已生成内容落库，让刷新后连最后 2000 字也不丢，彻底消除「记录不存在 / 空消息残留」。

### 4. 顺带：暴露 cause 的价值

最初报错只有 `Failed query + params`，看不出真实原因（DrizzleQueryError 把真实 DB 错误藏在 `cause`）。补上 cause 后才拿到「Too many subrequests」——否则还困在错误的 sanitize 方向上。

## 关键洞察

- **Cloudflare 上「频繁写 DB」=「subrequest 消耗大」**：neon-http 每次查询都是外部 fetch，免费计划 50 次/请求，任何「循环里写 DB」的模式都要警惕
- **报错信息会骗人**：`Failed query: update messages` 指向的是最后那次 update，不是真正的原因（累计 subrequest 超限）；connect 层报错要优先看 cause，而非单条 SQL
- **「本地正常、线上报错」优先怀疑平台配额**：本地 postgres-js 走 TCP 没有 subrequest 概念，线上 neon-http 走 HTTP 每个查询都算一次
- **走弯路是 cause 缺失的代价**：若一开始就暴露 cause，不用先加 sanitizeDbText 再回滚
- **省 subrequest 不能靠「归零写入」**：一次性写入看似最省，却引入更糟的脏状态（刷新后空消息/缺消息）。正确方向是**降频而非归零**——阈值放大到 2000 字，既稀疏到不超限，又保留刷新保护

## 相关文档

- [ADR-014](../decisions/014-agent-streaming-db-write.md) — 一次性写入的原始决策（本次修复回归它）
- [neon-rag-deployment](2026-08-31-neon-rag-deployment.md) — 上线 Neon 部署（本 Bug 触发背景）
- [cloudflare-edge-notes](../learning-notes/cloudflare-edge-notes.md) — Edge 约束
