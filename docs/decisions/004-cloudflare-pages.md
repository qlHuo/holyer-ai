# ADR-004: Cloudflare Workers 部署

> 日期：2026-05-31 · 状态：✅ 已采纳 · 更新：2026-07-05（Pages → Workers）

---

## 背景

需要为 Nuxt 4 全栈应用选择部署平台。核心需求：SSE 流式支持、Edge Runtime 兼容、低成本、全球 CDN。

## 决策

**选择 Cloudflare Workers（免费计划）**，不需要额外后端服务器。域名 DNS 托管于 Cloudflare（域名注册在腾讯云）。

## 部署架构

```
用户浏览器
    │
    ▼
Cloudflare Worker (Nitro/Nuxt 4 — SSR + API Routes)
    │
    ├──► OpenAI / Anthropic / DeepSeek API (外部)
    ├──► Neon PostgreSQL (HTTP 连接池化)
    └──► SSE 流式响应 → 用户浏览器
```

> **2026-07-05 更新**：最初选型为 Cloudflare Pages + Functions，后因构建 OOM（全量打包内存溢出）切换为独立 Worker，使用 `nitro.preset: 'cloudflare-module'`。详见 [构建 OOM 修复](../dev-log/2026-07-05-cloudflare-worker-build-oom.md)。

## 关键细节

| 事项 | 说明 |
|------|------|
| **SSE 心跳** | 每 30s 发送 `event: ping`，防止 100s 空闲超时断开连接 |
| **压缩禁用** | `/api/chat` 需在 Cloudflare Dashboard 关闭 Brotli/Gzip 自动压缩 |
| **部署命令** | `npx nuxi build`（配置 `nitro.preset: 'cloudflare-module'`） |
| **DB 连接** | Neon HTTP 连接池化 URL（含 `-pooler.`），HTTP 驱动不需要 TCP |

## 成本

Cloudflare Workers 免费计划（10 万请求/天）+ Neon 免费层（0.5GB），**初期 $0/月**。

## 关键技术限制

- **100s 空闲超时**：所有计划（含免费）都有的硬限制，必须通过心跳和客户端重连缓解
- **CPU 时间**：免费计划 10ms/请求。AI 请求主要是 I/O 等待，不消耗 CPU
- **Edge Runtime 无 Node API**：`fs`、`child_process`、`net` 全部不可用，所有依赖必须 Edge 兼容
