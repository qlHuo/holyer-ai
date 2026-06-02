# 2026-06-03 — SSE 工具与 /api/chat 端点实现

> SSE 工具的本质是"透传 + 格式转换"——把 Provider 的纯文本 token 流包装成浏览器可逐块消费的 SSE 协议格式，同时加上心跳保活和资源清理。

---

## 讨论背景

Phase 1.1（数据库）和 1.2（LLM Provider 层）完成后，进入 1.3（SSE 工具）和 1.4（/api/chat 端点）。这两个任务紧密耦合——SSE 工具是 /api/chat 的前置依赖，/api/chat 是 SSE 工具的唯一消费者（Phase 1 阶段）。

在实现过程中，围绕"为什么需要 SSE 工具而不是直接 return Provider 的流"展开了深入讨论，并实际编写了 `server/utils/sse.ts` 和 `server/api/chat/index.post.ts`。

---

## 核心结论

### 1. SSE 工具做了什么：两层 ReadableStream 的包装模式

```
Provider 产出的流                     SSE 工具产出的流
─────────────────                    ─────────────────
ReadableStream<string>               ReadableStream<Uint8Array>
  reader.read() → "你"       →        controller.enqueue("data: {\"type\":\"text\",\"content\":\"你\"}\n\n")
  reader.read() → "好"       →        controller.enqueue("data: {\"type\":\"text\",\"content\":\"好\"}\n\n")
  reader.read() → "！"       →        controller.enqueue("data: {\"type\":\"text\",\"content\":\"！\"}\n\n")
  ...                                 ...
                                      + setInterval 每 30s:
                                        controller.enqueue("event: ping\ndata: {}\n\n")
                                      + 流结束:
                                        controller.enqueue("data: {\"type\":\"done\"}\n\n")

内层（纯文本）                        外层（SSE 格式 + 心跳 + 生命周期）
```

**关键设计**：不是简单地在 Provider 流上套一层 `data:` 前缀。需要同时处理三个正交关注点：

| 关注点 | 实现 | 不处理的后果 |
|--------|------|-------------|
| SSE 格式转换 | `data: {json}\n\n` 双换行 | 浏览器不认，不能逐块消费 |
| 心跳保活 | `setInterval` 每 30s 发 `event: ping\ndata: {}\n\n` | Cloudflare 100s 空闲超时切断连接 |
| 资源清理 | `isClosed` 标志 + `clearInterval` + `controller.close()` | 内存泄漏，继续消耗 API 调用额度 |

### 2. 双环境兼容：Node.js close 事件 vs Workers cancel 回调

```ts
// Node.js 开发环境
if (event.node?.req) {
  event.node.req.on('close', () => { isClosed = true })
}

// Cloudflare Workers 生产环境
cancel() {
  isClosed = true
}
```

**根因**：`event.node` 在 Workers 中不存在（Workers 没有 Node.js `http.ServerRequest`）。可选链 `?.` 保证 Workers 下不报错。Workers 的 ReadableStream 被取消时会走 `cancel()` 回调，在那里设置关闭标志。

两者共享同一个 `isClosed` 标志位，心跳定时器每次都检查它，防止向已关闭的流写数据。

### 3. SSE 响应头的四个关键字段

| Header | 值 | 没它会发生什么 |
|--------|-----|---------------|
| `Content-Type` | `text/event-stream` | 浏览器不识别 SSE，不逐块消费 |
| `Cache-Control` | `no-cache` | 中间代理可能缓存，重复请求返回旧数据 |
| `Connection` | `keep-alive` | 每次 token 都要重新 TCP 握手 |
| `X-Accel-Buffering` | `no` | nginx 反向代理会攒够缓冲区才转发，流式变批量 |

**踩坑 1 — Content-Type 拼写错误**：实际编写时把 `text/event-stream` 误写为 `text/event-stram`（少了一个 `e`），导致浏览器不识别 SSE 流。curl 看不出来（数据照样到了），但浏览器 `fetch` + `reader.read()` 的行为会有细微差异。**2026-06-03 发现这个 typo 一直遗留在代码中未修复。**

**踩坑 2 — 缺少 `charset=utf-8` 导致中文乱码**：Content-Type 只写了 `text/event-stream` 没有 `charset=utf-8`。结果是 **server 端 `console.log` 正常，但 HTTP 响应的 content 字段全是乱码**。

根因链路：

```
Server 内存（UTF-16）           HTTP 传输（UTF-8 bytes）           Client 解码
─────────────────              ──────────────────────           ──────────
"你" = U+4F60                  TextEncoder → E4 BD A0         如果按 Latin-1 解码：
console.log 正常 ✓              (3 个字节)                     E4→ä, BD→½, A0→ 
                                                              3 个乱码字 ✗
```

**为什么 `console.log` 正常但响应乱码**：`console.log` 在服务端内存中打印，字符串还是 UTF-16，没有经过编码—传输—解码的往返。一旦 `TextEncoder` 把字符串编码为 UTF-8 字节发出，客户端如果缺少 `charset=utf-8` 声明，可能回退到 Latin-1（单字节编码），导致每个中文字（3 字节）被拆成 3 个独立的乱码字符。

**修复**：`'Content-Type': 'text/event-stream; charset=utf-8'`

### 4. `/api/chat` 端点的数据流路径

```
浏览器 POST /api/chat ──► defineEventHandler
                              │
                              ▼  readBody → { provider, model, message }
                              │
                          createLLMProvider(provider)
                              │
                              ▼  provider.chat(message, options)
                              │
                          ReadableStream<string>  ←─ "你" "好" "！" ...
                              │
                              ▼  createSSEResponse(llmStream, event)
                              │
                          new Response(stream, { headers: {...} })
                              │
                              ▼
浏览器 fetch ──► reader.read() ──► 逐字渲染
```

与 test 端点的本质区别：test 端点把 Provider 的流**在服务端内部消费完**，拼成完整字符串后一次性返回 JSON；/api/chat 把流**透传给客户端**，每收到一个 token 就立刻推出去。

---

## 关键洞察

- **流式对话的核心不是"能拿到流"，而是"能透传流"**：Provider 层产出 `ReadableStream<string>` 只是第一步，把这个流实时推给浏览器才是真正的挑战。test 端点验证了第一步，SSE 工具完成了第二步
- **SSE 的 `event:` 字段区分消息类型**：普通数据用 `data:` 行，心跳用 `event: ping\ndata: {}`，前端可以根据 event 类型决定是否处理
- **`TextEncoder` 是 SSE 和 ReadableStream 之间的桥梁**：`ReadableStream` 的 `controller.enqueue()` 只接受 `Uint8Array`，SSE 是字符串格式，`TextEncoder.encode()` 完成转换
- **调试 SSE 端点应该从 curl 开始**：`curl -N` 最直接看到流式数据格式，不需要写任何前端代码。浏览器 fetch 是第二步，用于验证浏览器环境的实际行为

## 测试方法速查

### curl（最快验证）

```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"provider":"deepseek","model":"deepseek-v4-flash","message":[{"role":"user","content":"你好"}]}'
```

`-N` 禁用 curl 自带缓冲，不加的话流式输出会变成一次性全部出现。

### 浏览器 fetch（模拟前端消费）

```js
const res = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    message: [{ role: 'user', content: '你好' }]
  })
})

const reader = res.body.getReader()
const dec = new TextDecoder()
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  // 手动解析 SSE 行
  for (const line of dec.decode(value, { stream: true }).split('\n')) {
    if (line.startsWith('data: ')) {
      console.log(JSON.parse(line.slice(6)))
    }
  }
}
```

### 常见问题速查

| 现象 | 可能原因 | 检查方法 |
|------|---------|---------|
| curl 立刻返回空 | API Key 没配 | 看终端报错 `API Key 未配置` |
| 输出一次性全部出现 | curl 自带缓冲 | 加 `-N` 参数 |
| 浏览器 Network 里看不到流 | Content-Type 拼写错误 | 检查 `text/event-stream` |
| 404 | 用了 GET 而不是 POST | `index.post.ts` 只响应 POST |
| 100s 后断开 | 心跳没生效 | 检查 setInterval 是否在执行 |
| 中文 content 乱码，但 server console.log 正常 | Content-Type 缺 `charset=utf-8`，客户端用 Latin-1 解码 UTF-8 字节 | 检查 `Content-Type` 是否为 `text/event-stream; charset=utf-8` |

---

## 相关文档

- [2026-05-31 流式架构深层讨论](./2026-05-31-streaming-architecture.md) — 四段流式模型、为什么后端不可或缺
- [2026-06-01 Provider 实现记录](./2026-06-01-provider-implementation.md) — 三层 Provider 架构、SSE 字节流解析
- [2026-05-31 项目初始化指南](./2026-05-31-scaffold-guide.md) — Phase 1.3-1.4 操作步骤
- [架构设计](../../.claude/plan/architecture.md) — 3.6 SSE 心跳机制
- [实施路线图](../../.claude/plan/roadmap.md) — Phase 1 任务清单
