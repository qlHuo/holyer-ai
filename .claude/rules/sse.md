---
paths:
  - "server/api/chat/**"
  - "server/api/agent/**"
  - "server/utils/sse.ts"
description: SSE 流式响应规范 — 心跳机制、响应头、数据格式、部署压缩禁用
---

# SSE 流式响应规则

## 何时应用此规则

- 新增或修改 SSE 端点（`/api/chat`、`/api/agent` 等流式路由）
- 修改 `server/utils/sse.ts` 工具函数
- 流式响应出现"中途断开""无响应""响应卡住"等问题
- 部署后流式输出不实时（可能是压缩未关闭）
- 前端 SSE 连接不稳定时需要排查

## 心跳机制（必须实现）

Cloudflare Workers（所有计划，含免费）有 100s 空闲超时限制。每个 SSE 端点**必须**包含 30 秒心跳：

```ts
const heartbeat = setInterval(() => {
  controller.enqueue('event: ping\ndata: {}\n\n')
}, 30000)

event.node.req.on('close', () => clearInterval(heartbeat))
```

心跳工具函数统一在 `server/utils/sse.ts` 中实现，各端点复用。

## 响应头

每个 SSE 端点必须设置：

```
Cache-Control: no-cache
Content-Type: text/event-stream; charset=utf-8
Connection: keep-alive
```

## 数据格式

```
data: {"type":"text","content":"你好"}\n\n
event: ping\ndata: {}\n\n
```

## 部署后配置

在 Cloudflare Dashboard → Pages → 你的项目 → Settings → Compression：
- 对 `/api/chat` 路径禁用 Brotli 和 Gzip 压缩
- 原因：压缩会缓冲输出直到响应完成，破坏 SSE 实时流

## 客户端重连

前端 `useChat` composable 需实现：
- SSE 连接断开时自动重连（指数退避）
- 重连时携带 `Last-Event-ID` 头实现断点续传
