# ADR-004: Cloudflare Pages 部署

> 日期：2026-05-31 · 状态：✅ 已采纳

---

## 背景

需要为 Nuxt 4 全栈应用选择部署平台。核心需求：SSE 流式支持、Edge Runtime 兼容、低成本、全球 CDN。

## 决策

**选择 Cloudflare Pages（付费计划）**，不需要额外后端服务器。

## 部署架构

```
用户浏览器
    │
    ▼
Cloudflare Pages (Nuxt 4 SSR + API Routes)
    │
    ├──► Cloudflare Worker (Nitro API)
    │       │
    │       ├──► OpenAI / Anthropic / DeepSeek API (外部)
    │       ├──► Neon PostgreSQL (HTTP 连接)
    │       └──► SSE 流式响应 → 用户浏览器
    │
    └──► 静态资源 (CDN 边缘缓存)
```

## 关键细节

| 事项 | 说明 |
|------|------|
| SSE 心跳 | 每 30s 发送 `event: ping`，防 100s 空闲超时 |
| 压缩禁用 | `/api/chat` 需在 Dashboard 关闭 Brotli/Gzip |
| 部署命令 | `npx nuxi build`（`nitro.preset: 'cloudflare-pages'`） |
| DB 连接 | Neon HTTP 连接池化 URL（含 `-pooler.`） |

## 成本

~$5/月（Workers 按量），Neon 初期免费。

## 关键技术限制

- **100s 空闲超时**：所有计划（含免费）都有的硬限制，必须通过心跳和客户端重连缓解
- **Edge Runtime 无 Node API**：`fs`、`child_process`、`net` 全部不可用，所有依赖必须 Edge 兼容
- **CPU 时间**：付费计划默认 30s，AI 请求主要是 I/O 等待不消耗 CPU
