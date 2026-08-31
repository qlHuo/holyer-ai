# 2026-09-01 — 消息内容写入 Postgres 失败：非法字符清洗 + 暴露 Drizzle 的 cause

> 核心洞察：报错表面是「update messages 失败」，真正根因藏在 DrizzleQueryError 的 cause 里——LLM 生成内容夹带了 Postgres text 列拒绝的字符（NUL / C0 控制字符 / lone surrogate）。

---

## 讨论背景

阶段 A 上线 Neon 后，线上向 RAG 知识库提问，前端收到一条 SSE error：

```
Failed query: update "messages" set "content" = $1 where "messages"."id" = $2
params: # 当前项目整体流程介绍 …（整篇回答）,c22c0327-…
```

排查后定位：报错不在 RAG 检索，而在保存最终回答的 `UPDATE messages` 失败。

## 核心内容

### 1. 报错位置：不是检索，是落库

chat 端点流结束时，把 AI 完整回答写入 DB：

```ts
await updateMessage(finalMsgId, { content: contentBuffer })
```

`messages.content` 是 `text` 类型（无限长），长度不是问题。真正的问题是 content 里夹带了 Postgres 拒绝存储的字符：

- **NUL 字节（U+0000）与 C0 控制字符** → Postgres 报 `invalid byte sequence for encoding UTF8`
- **孤立代理项（lone surrogate，U+D800~U+DFFF）** → 破坏 neon-http 的 JSON 请求体，报 HTTP 400

这类字符在 LLM 输出、网页 / 检索内容里都可能出现。

### 2. 报错信息为什么这么难懂

Drizzle 的 `DrizzleQueryError` 把真实 DB 错误藏在 `.cause` 里，`message` 只拼了 SQL + params：

```js
super(`Failed query: ${query}\nparams: ${params}`)
```

而 chat 端点 catch 只回传 `error.message`，于是用户看到的是 `params: ${[content, id].toString()}` —— 数组 toString 会把整篇回答和消息 ID 都倒出来，看起来像「内容本身有问题」，其实是掩盖了 cause。

### 3. 修复两件套

1. **清洗非法字符**：新增 `server/utils/text.ts` 的 `sanitizeDbText`，在 mutations 层三处 content 写入（`addMessages` / `insertMessage` / `updateMessage`）前统一清洗，覆盖 user / assistant / tool 三类消息：
   - NUL + C0 控制字符（保留 `\t \n \r`）→ 删除
   - 孤立代理项 → U+FFFD
2. **暴露 cause**：chat 端点 catch 把 `cause.code / message / detail` 打进 `console.error`（供 wrangler tail 排查）+ 附到 SSE，让前端能看到真实 DB 错误码。

## 关键洞察

- **「本地正常、线上报错」优先怀疑驱动差异**：lone surrogate 在本地 postgres-js（二进制协议）能混过去，线上 neon-http（HTTP/JSON）会报 400——与 08-31 那篇「TCP 被重置」同属「协议 / 传输差异」这一族
- **DrizzleQueryError 的 message 会骗人**：`params: ${数组}` 的 toString 把大文本参数整段倒出来，掩盖了 cause；排查这类报错第一件事是看 `error.cause`，不是 message
- **清洗放 mutations 层而非 provider 层**：工具结果（web / RAG）和 LLM 输出都可能带非法字符，在 DB 写入边界统一清洗覆盖所有来源，比在 LLM 输出处逐个补更稳

## 相关文档

- [neon-rag-deployment](2026-08-31-neon-rag-deployment.md) — 上线 Neon 的部署与网络踩坑（本 Bug 的触发背景）
- [rag-stage-a-implementation](2026-08-31-rag-stage-a-implementation.md) — 阶段 A 落地（RAG 检索链路）
- [cloudflare-edge-notes](../learning-notes/cloudflare-edge-notes.md) — Edge 双驱动约束
