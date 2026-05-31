# Cloudflare Workers Edge Runtime 笔记

---

## 核心限制

### 1. 100s 空闲超时（关键）

**所有计划（含免费、付费）都有 100s 空闲超时**，不是只有免费计划。

影响：
- SSE 长连接超过 100s 无数据会被切断
- 长时间无响应的 Agent 循环会被中断

解决方案：
- **SSE 心跳**：每 30s 发送 `event: ping\ndata: {}\n\n`
- 客户端自动重连（收到 ping 之外的事件时重置计时器）

### 2. 不可用的 Node.js API

```
❌ fs            → 使用 R2 对象存储
❌ child_process → 使用 Workers for Workers 或外部服务
❌ net (TCP)     → 使用 HTTP/WebSocket
❌ crypto.subtle → ✅ 可用（Web Crypto API）
❌ __dirname     → 使用 import.meta.url
```

### 3. CPU 时间限制

| 计划 | CPU 时间 | 说明 |
|------|---------|------|
| 免费 | 10ms | 非常受限 |
| 付费 | 30s（可配置至 5min） | AI 请求主要是 I/O 等待 |

### 4. 子请求限制

Worker 最多发起 50 个子请求（fetch），包括数据库查询和第三方 API 调用。对于 AI Agent 场景一般够用。

## SSE 特有注意事项

### 压缩必须禁用

Cloudflare 默认启用 Brotli/Gzip 压缩，会缓冲响应直到缓冲区满才发送——这破坏了 SSE 实时性。

**部署后必须**在 Cloudflare Dashboard → Speed → Optimization → Content Optimization 中，对 `/api/chat` 路由关闭自动压缩。

### 心跳实现模板

```ts
// server/utils/sse.ts
function createSSEStream(event: H3Event) {
  const stream = new ReadableStream({
    start(controller) {
      const heartbeat = setInterval(() => {
        controller.enqueue('event: ping\ndata: {}\n\n')
      }, 30_000)

      event.node.req.on('close', () => {
        clearInterval(heartbeat)
      })
    }
  })
  return stream
}
```

## 数据库连接

- **必须使用 HTTP 驱动**：`@neondatabase/serverless`，不能用 `pg`（需要 TCP）
- **连接池化**：URL 必须含 `-pooler.`（如 `postgresql://...-pooler.neon.tech/...`）
- **Drizzle 驱动**：`drizzle-orm/neon-http`，不能使用 `drizzle-orm/node-postgres`

## npm 依赖 Edge 兼容性速查

| 依赖 | Edge 兼容 | 备注 |
|------|:---:|------|
| `openai` v4+ | ✅ | 默认使用 `fetch` API |
| `@anthropic-ai/sdk` | ⚠️ | 需验证最新版是否移除 Node API |
| `drizzle-orm` (neon-http) | ✅ | 专用驱动 |
| `langchain` | ❌ | 依赖 Node.js API |
| `@nuxt/ui` | ✅ | SSR 安全 |
| `zod` | ✅ | 纯 JS 校验 |
