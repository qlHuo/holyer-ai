# Web Streams API 详解：后端流式管道中的核心原语

> 一文讲清楚 `ReadableStream`、`TextEncoder`、`Response`、`fetch` 等 Web API 在 holyer-ai 后端代码中扮演什么角色、为什么需要它们、以及它们如何串联起整个流式数据管道。

---

## 背景

Edge Runtime（Cloudflare Workers）不提供 Node.js 的 `http` 模块，取而代之的是 Web 标准 API：`ReadableStream`、`Request`/`Response`、`TextEncoder`/`TextDecoder`、`fetch`。这些 API 对前端开发者可能不陌生（浏览器里也有），但用在**服务端**的场景和模式与前端完全不同。

本文档逐一拆解项目中用到的每个核心 API，说明它"是什么""在代码的哪个位置被使用""扮演了什么角色"。

---

## 1. ReadableStream（可读流）

### 基本概念

`ReadableStream<T>` 是 Web Streams API 的核心类。它代表一条"数据管道"——数据不是一次性全部到齐，而是一块一块（chunk）地流过来。泛型 `T` 指定每个 chunk 的类型。

### 为什么项目需要它

LLM 的回复是逐 token 生成的——"你"→"好"→"吗"→"？"。如果把整个回复等完再发给前端，用户盯着白屏等 10 秒。`ReadableStream` 让每个 token 一生成就能立刻推送出去，实现"打字机效果"。

### 在项目中的三种角色

**角色 1：接口契约**（[server/service/llm/types.ts:19](../server/service/llm/types.ts#L19)）

```ts
// 所有 Provider 的 chat() 方法都返回这个类型
chat(messages: Message[], options: ChatOptions): Promise<ReadableStream<string>>
```

`ReadableStream<string>` 的意思是：这是一个流，里面流着的数据是一段一段的 `string`（纯文本 token）。上层代码不需要知道底层是 OpenAI 还是 Anthropic——它只知道从这个流里读 token。

**角色 2：作为生产者（创建流）** — Provider 层和 chat 端点中

```ts
// 创建一个新流，往里面灌数据
return new ReadableStream({
  async start(controller) {
    controller.enqueue(chunk1)  // 放一块
    controller.enqueue(chunk2)  // 再放一块
    controller.close()          // 放完，关闭管道
  }
})
```

**角色 3：作为消费者（读流）** — 通过 `getReader()` 读取

```ts
const reader = llmStream.getReader()  // 拿到 reader
while (true) {
  const { done, value } = await reader.read()
  if (done) break          // 流结束了
  // 处理 value（这个 chunk 的数据）
}
```

### 项目中的完整流管道

```
OpenAI SDK 流         Provider 创建的流          chat 端点创建的流         SSE 工具创建的流
──────────────       ──────────────────        ──────────────────      ────────────────
AsyncIterable        ReadableStream<string>     ReadableStream<SSEChunk>  ReadableStream<Uint8Array>
      ↓                        ↓                          ↓                       ↓
"你" → controller.enqueue("你") → reader.read() → "你" → enqueue({type:"text"}) → data: {"type":"text"...}\n\n
"好" → controller.enqueue("好") → reader.read() → "好" → enqueue({type:"text"}) → data: {"type":"text"...}\n\n
done → controller.close()      → reader.read() → done → enqueue({type:"done"}) → controller.close()
```

每一层只改变数据的表示形式（string → SSEChunk → Uint8Array），不改变数据的流向。

---

## 2. ReadableStreamDefaultController（流控制器）

### 基本概念

`new ReadableStream({ start(controller) { ... } })` 时，浏览器/运行时自动创建一个 controller 对象传给 `start()`。它就是往流里"放数据"的遥控器——不需要自己创建，运行时注入。

### 三个核心方法

| 方法 | 作用 | 使用位置 |
|------|------|---------|
| `controller.enqueue(chunk)` | 往流里放一块数据 | 每收到一个 token 就 enqueue 一次 |
| `controller.close()` | 关闭流，标记"没有更多数据了" | LLM 回复结束、或流程正常完成 |
| `controller.error(e)` | 出错时关闭流并传递错误对象 | Provider 层捕获 LLM 调用异常时 |

### 类型约束

controller 接受的数据类型取决于 `ReadableStream<T>` 的泛型参数：

- `ReadableStream<string>` 的 controller → `enqueue(str: string)`
- `ReadableStream<SSEChunk>` 的 controller → `enqueue(obj: SSEChunk)`
- `ReadableStream<Uint8Array>` 的 controller → `enqueue(bytes: Uint8Array)`

### 在项目中的使用示例

```ts
// server/utils/sse.ts:49 — 心跳也通过 controller 发送
controller.enqueue(encoder.encode('event: ping\ndata: {}\n\n'))

// server/utils/sse.ts:61 — 每个 SSEChunk 包装成 SSE 格式后发送
controller.enqueue(encoder.encode(`data: ${payload}\n\n`))

// server/utils/sse.ts:73 — 流结束
controller.close()

// server/service/llm/openai.ts:99 — 出错时传递错误
controller.error(error)
```

---

## 3. ReadableStreamDefaultReader（流读取器）

### 基本概念

通过 `stream.getReader()` 获得。一个流**同时只能有一个 reader**（类似"一个水龙头只能一个人拧"）。reader 的 `read()` 方法返回 `Promise<{ done: boolean, value: T | undefined }>`。

### 返回值的两种状态

| `done` | `value` | 含义 |
|:------:|---------|------|
| `false` | 下一个 chunk | 还有数据，继续读 |
| `true` | `undefined` | 流已经结束 |

### 在项目中的使用（chat/index.post.ts:72）

```ts
const reader = llmStream.getReader()
let contentBuffer = ''

while (true) {
  const { done, value } = await reader.read()
  if (done) break

  contentBuffer += value                         // 累积 — 用于流结束后一次性写库
  controller.enqueue({ type: 'text', content: value })  // 增量 — 发送给前端
}
```

**关键设计**：`reader.read()` 返回的 `value` 是**增量**（这个 token 新生成的内容），不是累积值。所以：
- `contentBuffer += value` → 累积，等流结束后一次性 INSERT 到数据库
- `controller.enqueue({ content: value })` → 直接发增量，前端自己拼接显示

---

## 4. TextEncoder

### 基本概念

Web API，将字符串编码为 UTF-8 字节数组。Edge Runtime 和浏览器均内置。

```ts
const encoder = new TextEncoder()
encoder.encode('你好')  // → Uint8Array [228, 189, 160, 229, 165, 189]
```

### 为什么需要它

计算机传输数据只能用字节（`Uint8Array`），但业务逻辑处理的是字符串。`TextEncoder` 就是字符串 → 字节的翻译官。

### 在项目中的使用（sse.ts:41,49,61）

SSE 工具的最外层流是 `ReadableStream<Uint8Array>`（因为要写入 HTTP Response body），所以 `controller.enqueue()` 只接受 `Uint8Array`。所有 SSE 格式的字符串都必须先 `encoder.encode()` 再入队：

```ts
// 心跳
controller.enqueue(encoder.encode('event: ping\ndata: {}\n\n'))

// 数据
controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
```

---

## 5. TextDecoder

### 基本概念

Web API，将字节数组解码为字符串。`TextEncoder` 的反向操作。

```ts
const decoder = new TextDecoder('utf-8')
decoder.decode(uint8Array)  // → string
```

### `{ stream: true }` 参数 —— 最容易误解的地方

```ts
decoder.decode(value, { stream: true })
```

**问题**：UTF-8 中一个中文字占 3 个字节，一个 emoji 占 4 个字节。如果网络传输的字节块边界恰好把一个多字节字符切成两半：

```
字节流：E4 BD A0 (这是"你"的 3 字节)
        │        │
     chunk1    chunk2

不加 stream:true → decode(chunk1) = "ä½ " (乱码!) → 再 decode(chunk2) = " " (永久损坏)
加上 stream:true → decode(chunk1) = "" (缓存残缺字节，不输出) → decode(chunk2) = "你" ✅
```

`stream: true` 告诉解码器："后面还有数据，这几个不完整的字节先缓存着，别急着解码输出"。

### 另一个关键细节：buffer 管理

```ts
// deepseek.ts:136-138 —— 手动 SSE 解析中的 buffer 技巧
buffer += decoder.decode(value, { stream: true })
const lines = buffer.split('\n')
buffer = lines.pop()!  // 最后一行可能不完整，保留在 buffer 中
```

`lines.pop()` 取出数组最后一个元素（不完整的行），放回 buffer。等下一个 chunk 到了继续拼接。这是手动 SSE 解析的标准 pattern。

### 在项目中的使用（deepseek.ts:117,136）

DeepSeek Provider 用纯 `fetch` 实现，所以需要手动解析 SSE 字节流。`TextDecoder` 负责把 `Uint8Array` chunk 解码为字符串，然后逐行解析 SSE 格式。

---

## 6. Response（Web API）

### 基本概念

`Response` 是 Web Fetch API 的响应对象。注意：**不是** Node.js 的 `http.ServerResponse`。Edge Runtime 使用 Web 标准的 `Response`。

### 在项目中的两种角色

**角色 1：HTTP 服务端构造响应**（sse.ts:83）

```ts
return new Response(stream, {
  headers: {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  }
})
```

- 第一个参数是 body，可以是 `ReadableStream<Uint8Array>`（流式响应）或 `string`
- 第二个参数是配置对象（headers、status 等）
- Nitro/H3 认识这个 `Response`，会直接作为 HTTP 响应返回给客户端

**四个关键响应头**：

| Header | 值 | 没它会发生什么 |
|--------|---|--------------|
| `Content-Type` | `text/event-stream; charset=utf-8` | 浏览器不识别 SSE；缺 `charset` 中文乱码 |
| `Cache-Control` | `no-cache` | 中间代理可能缓存，重复请求返回旧数据 |
| `Connection` | `keep-alive` | 每个 token 都要重新 TCP 握手 |
| `X-Accel-Buffering` | `no` | nginx/CDN 会攒够缓冲区才转发，流式变批量 |

**角色 2：HTTP 客户端消费响应**（deepseek.ts:88）

```ts
const response = await fetch('https://api.deepseek.com/chat/completions', { ... })
// response.ok      → boolean (status 200-299)
// response.status  → number (200, 404, 500...)
// response.body    → ReadableStream<Uint8Array> | null (响应的原始字节流)
```

### 与 Node.js res.end() 的对比

```ts
// 传统 Node.js HTTP
res.writeHead(200, { 'Content-Type': 'text/plain' })
res.write('hello')
res.end()

// Edge Runtime (Web API)
return new Response(stream, { headers: { ... } })
```

Edge Runtime 没有 `req`/`res` 的 Node.js 对象体系，用的是 Web 标准的 `Request`/`Response`。

---

## 7. fetch（Web API）

### 基本概念

`fetch()` 是浏览器里发 HTTP 请求的标准 API。在 Cloudflare Workers 中，它是**唯一的 HTTP 客户端**（Node.js 的 `http` 模块不可用）。

### 在项目中的使用（deepseek.ts:88）

DeepSeek Provider 用裸 `fetch` 调用 LLM API，不依赖任何 SDK：

```ts
const response = await fetch(`${this.baseUrl}/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${this.apiKey}`
  },
  body: JSON.stringify(body)
})
```

对比 OpenAI Provider 使用的是 `openai` npm 包（内部也是封装 `fetch`），DeepSeek Provider 直接用裸 `fetch` 演示了"不需要 SDK 也能调 LLM API"。

---

## 8. H3Event（event.node?.req）

### 基本概念

H3/Nitro 框架的事件对象，封装了当前 HTTP 请求的上下文。`event.node?.req` 只在 Node.js 开发环境下存在。

### 在项目中的使用（sse.ts:33）

```ts
// Node.js 环境 — 监听客户端断开
if (event.node?.req) {
  event.node.req.on('close', () => {
    isClosed = true
  })
}

// Cloudflare Workers 环境 — 通过 cancel() 回调感知断开
cancel() {
  isClosed = true
}
```

`?.` 可选链保证 Workers 下不报错。两种环境共享同一个 `isClosed` 标志位，心跳定时器每次都检查它，防止向已关闭的流写数据。

---

## 9. ReadableStream 的 cancel() 回调

### 基本概念

```ts
const stream = new ReadableStream({
  async start(controller) { ... },  // 流启动时执行
  cancel() {                         // 消费者断开连接时执行
    isClosed = true
  }
})
```

`cancel()` 是 ReadableStream 的生命周期钩子。当消费者（浏览器）断开连接时触发。在 Cloudflare Workers 环境下，这是感知"客户端已离开"的**唯一**机制（因为没有 `event.node.req`）。

---

## 10. SSE 协议格式

虽然不是类或对象，但理解 SSE 的文本格式对阅读项目代码至关重要。

### 格式规则

- `data:` 开头 → 数据内容
- `event:` 开头 → 事件类型（可选，不写默认 `message`）
- **必须** `\n\n`（双换行）结尾，单换行 `\n` 浏览器不认

### 在项目中的体现

```
// 心跳（event + data 两个字段，同一条消息）
event: ping\ndata: {}\n\n

// 普通数据（只有 data 行）
data: {"type":"text","content":"你好"}\n\n
```

### 常见坑

| 坑 | 现象 | 原因 |
|----|------|------|
| 单换行 `\n` 结尾 | 浏览器不触发 onmessage | SSE 标准要求 `\n\n` |
| 缺 `charset=utf-8` | 中文 content 乱码但 console.log 正常 | 客户端回退到 Latin-1 解码 UTF-8 字节 |
| Content-Type 拼写错误 | 浏览器不识别为 SSE | `text/event-stram` vs `text/event-stream` |

---

## 数据在各对象间的完整流动

```
DeepSeek API
     │
     ▼  fetch() 返回
  Response (body = ReadableStream<Uint8Array>)
     │
     ▼  response.body!.getReader()
  ReadableStreamDefaultReader
     │  reader.read() → { done, value: Uint8Array }
     ▼  decoder.decode(value, { stream: true })
  string (SSE 原始行)
     │  parseLine() → 解析 "data: {...}"
     ▼  controller.enqueue(token)
  ReadableStream<string>   ← Provider 层统一产出
     │
     ▼  reader2.read() → { done, value: string }
  contentBuffer += value   ← 累积用于流结束后一次性写库
     │
     ▼  controller2.enqueue({ type: 'text', content: value })
  ReadableStream<SSEChunk>  ← chat 端点的事件流
     │
     ▼  reader3.read() → { done, value: SSEChunk }
  JSON.stringify(value) → encoder.encode()
     │  controller3.enqueue(Uint8Array)
  ReadableStream<Uint8Array> ← SSE 工具的最终输出
     │
     ▼  new Response(stream, { headers })
  浏览器收到逐块的 SSE 数据
```

每个箭头代表一次"形式转换"，但数据本身一直向前流动，不回头。

---

## 关键洞察

- **ReadableStream 是流式系统的骨架**：项目中 6 个文件创建或消费 ReadableStream，3 种不同的泛型参数（string / SSEChunk / Uint8Array），每种代表管道的一个阶段
- **TextEncoder 和 TextDecoder 是字符串与字节世界的桥梁**：Edge Runtime 中一切网络传输都是字节，但业务逻辑是字符串——这两个 API 就是翻译官
- **Response 构造器让服务端代码看起来像前端代码**：`new Response(stream, { headers })` 替代了传统 Node.js 的 `res.writeHead` + `res.write` + `res.end` 三步操作
- **`{ stream: true }` 不是可选的优化，是正确性要求**：不传这个参数，多字节字符在 chunk 边界会被永久损坏
- **controller 对象的三个方法（enqueue/close/error）覆盖了流的所有生命周期**：enqueue 推送数据，close 正常结束，error 异常终止

---

## 相关文档

- [2026-05-31 流式架构深层讨论](../dev-log/2026-05-31-streaming-architecture.md) — 四段流式模型，数据从 LLM 到浏览器的完整路径
- [2026-06-03 SSE 工具实现](../dev-log/2026-06-03-sse-implementation.md) — SSE 工具的两层 ReadableStream 包装模式、TextEncoder/TextDecoder 实战
- [2026-06-01 Provider 实现记录](../dev-log/2026-06-01-provider-implementation.md) — DeepSeek Provider 手动 SSE 字节流解析、buffer 管理
- [Cloudflare Edge Runtime 笔记](cloudflare-edge-notes.md) — Edge 环境限制、SSE 心跳模板
