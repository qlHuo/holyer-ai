# 2026-05-31 — 流式架构深层讨论：为什么后端不可或缺

> 从"纯前端能做什么"到"四段流式管道"，一次讲清楚数据如何从 LLM 流到屏幕。

---

## 讨论起源

在评估 Vercel AI SDK 之后，延伸到更根本的问题：流式对话到底需要什么？纯前端能不能做？Agent/MCP/Skills 为什么必须要有后端？本章澄清这些问题，并给出流式输出的完整数据流模型。

---

## 1. 三个层次：你能做什么取决于代码跑在哪

### 第一层：纯前端直调 API

```
浏览器 ──fetch──▶ DeepSeek API ──SSE──▶ 浏览器渲染
```

```ts
// 在浏览器里直接写，不需要任何后端
const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
  headers: { 'Authorization': `Bearer sk-xxx` },
  body: JSON.stringify({ model: 'deepseek-chat', messages, stream: true })
})
// 消费 ReadableStream，逐字渲染到屏幕
```

**你能做的**：流式对话 ✅

**你做不了的**：

| 做不到 | 原因 |
|--------|------|
| 切换模型（OpenAI / Claude） | DeepSeek 的 Key 调不了 OpenAI |
| 让 AI 查询数据库 | 浏览器没有数据库连接 |
| 让 AI 搜索网页 | 浏览器不能跑服务端搜索逻辑 |
| 让 AI 执行代码 | 浏览器沙箱不允许 |
| 让 AI 读取本地文档 | 文档在硬盘上，API 访问不到 |
| 保存对话历史 | 只能存 localStorage，换设备就没了 |
| 调用外部工具（MCP） | 浏览器只能调它认识的 HTTP API |
| Skills 系统 | System Prompt 拼装逻辑+工具注册必须在服务端 |

**核心洞察**：纯前端直调，AI 是一个"嘴"——能说话，但没有手。对话内容就是一切，因为 AI 碰不到对话之外的任何东西。

### 第二层：有自己的后端服务

```
浏览器 ──SSE──▶ 你的 Nitro Server ──fetch──▶ DeepSeek / OpenAI / Claude
                         │
                         ├── 数据库 (对话历史、知识库)
                         ├── 工具执行 (搜索网页、读文件、算数学)
                         └── 技能注入 (System Prompt 拼装 + 工具注册)
```

**后端是 AI 的"手"**。以一个含工具调用的消息为例，看后端做了什么：

```
用户输入"帮我搜一下最新的 Vue 4 文档然后总结"
              │
              ▼
    ① Skills 层注入 System Prompt
       "你是一个技术助手，擅长搜索和总结..."
              │
              ▼
    ② Agent Runtime 发给 LLM
       LLM 返回：tool_call { name: "web_search", args: { query: "Vue 4 docs" } }
              │
              ▼
    ③ 你的后端拦截这个 tool_call（前端做不到！）
       执行 web_search("Vue 4 docs") → 拿到搜索结果
              │
              ▼
    ④ Agent 把搜索结果追加回上下文，再调 LLM
       LLM 返回："根据搜索结果，Vue 4 的主要变化是..."
              │
              ▼
    ⑤ SSE 流式推给浏览器
```

**步骤 ③ 是分水岭**。没有后端，LLM 说"我要搜索"——然后呢？你只能在浏览器里弹个 alert，什么也执行不了。

### 第三层：完整 AI 平台

把功能分层图倒过来看，每一层**为什么必须在后端**：

```
┌──────────────────────────────────┐
│  垂直场景 (如"代码审查")          │  ← 前端：专用 UI
├──────────────────────────────────┤
│  Skills  │  MCP   │   RAG        │  ← 后端：注入 prompt / 外部工具 / 向量检索
├──────────────────────────────────┤
│  Agent Runtime (ReAct 循环)      │  ← 后端：工具调用→执行→装配→再推理
├──────────────────────────────────┤
│  多模型流式对话                   │  ← 后端：统一 Provider → SSE → 前端
└──────────────────────────────────┘
```

| 层 | 为什么不能在前端 |
|----|-----------------|
| Provider 统一 | API Key 不能暴露在前端；不同 Provider SSE 格式不同需要服务端适配 |
| Agent Runtime | 工具执行代码必须跑在服务端（数据库、文件、网络请求） |
| Skills | System Prompt 拼装逻辑 + 工具注册 → 这是服务端逻辑 |
| MCP | MCP 协议是 HTTP/SSE 的服务端→服务端通信，浏览器不是 MCP Client |
| RAG | 向量数据库连接、Embeddings API 调用、文档解析 → 全部服务端 |
| 对话持久化 | 数据库连接 + CRUD |

**核心结论**：流式渲染只是传输方式，和项目的核心价值没有关系。真正的价值全部在 `server/services/` 里——那是 AI 的手、眼睛和记忆。前端只是这双手面对用户的"脸"。

---

## 2. 流式输出完整数据流：四段模型

```
DeepSeek 服务器                 你的 Nitro Server                       浏览器
──────────────────────────────────────────────────────────────────────────────

① 原始 SSE                   ② Provider 抽象层                 ④ useChat()
  data:{"choices":             chat(): ReadableStream            fetch + reader
  [{"delta":{"content":         把不同格式统一为                   逐块读 → 手动解析
  "你"}}]}                      纯文本 token 流                   SSE → 渲染到 UI
                                (server/services/llm/)
                                        │
                                        ▼
                               ③ /api/chat 端点
                                 包装 SSE + 心跳 + 响应头
                                 (server/api/chat/ + server/utils/sse.ts)
```

### 第一段：LLM 返回的原始数据

用 `curl -N` 直接打 OpenAI，看到的是**原始字节流**：

```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant"},"index":0}]}

data: {"id":"chatcmpl-xxx","choices":[{"delta":{"content":"你"},"index":0}]}

data: {"id":"chatcmpl-xxx","choices":[{"delta":{"content":"好"},"index":0}]}

data: {"id":"chatcmpl-xxx","choices":[{"finish_reason":"stop","delta":{},"index":0}]}

data: [DONE]
```

**关键特征**：一段一段的 JSON，用 `data:` 前缀分隔，每个 chunk 里 `delta.content` 就是 LLM 吐出的 token，最后一行是 `[DONE]`。

打 Anthropic，看到完全不同的格式：

```
event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"好"}}
```

**这一步要搞明白的**：两个 Provider 的原始格式不同，你的 Provider 必须把这两种格式读成同一种东西。

### 第二段：Provider 抽象层

**这是 `server/services/llm/` 做的事——把不同的流统一成一种流**：

```
      OpenAI 原始 SSE                         Anthropic 原始 SSE
    ──────────────────                    ──────────────────────
    data:{"choices":[{"delta":           event: content_block_delta
      {"content":"你"}}]}                 data:{"delta":{"text":"你"}}
           │                                       │
           ▼                                       ▼
    ┌─────────────────────────────────────────────────────┐
    │            LLMProvider 接口                          │
    │            chat(): ReadableStream<string>            │
    │            → 每个 Provider 内部解析自己的格式           │
    │            → 只产出纯文本 token                       │
    └─────────────────────────────────────────────────────┘
```

**容易犯的错**：把 OpenAI 的原始 chunk 格式作为统一格式。这样做的话，前端就要知道 `choices[0].delta.content`，换 Anthropic 就炸。正确做法是 Provider 内部吃差异，统一吐纯文本。

### 第三段：SSE 端点 + 心跳

有了 `ReadableStream<string>`（纯文本 token 流），通过 HTTP 推给前端：

```
                    LLMProvider.chat()
                          │
                          ▼  ReadableStream<string> ("你", "好", "！")
                          │
    ┌─────────────────────▼──────────────────────────┐
    │  /api/chat                                      │
    │  ① 消费 Provider 的流                            │
    │  ② 包装成 SSE 格式                               │
    │     data: {"type":"text","content":"你好"}\n\n   │
    │  ③ 每 30s 插入 heartbeat                         │
    │     event: ping\ndata: {}\n\n                    │
    │  ④ 设置正确响应头                                 │
    │     Cache-Control: no-cache                      │
    │     Content-Type: text/event-stream              │
    └──────────────────────────────────────────────────┘
```

**两个深坑**：

| 坑 | 现象 | 正确做法 |
|----|------|---------|
| SSE 换行不完整 | `data: {...}\n`（单换行）→ 浏览器 EventSource 不认 | SSE 标准要求 `\n\n` 双换行结尾 |
| Cloudflare 100s 空闲超时 | LLM 思考超过 100s 且无 token → 连接被掐断 | 每 30s 发 `event: ping\ndata: {}\n\n` 心跳 |

### 第四段：前端消费

前端用 `fetch`（不是 `EventSource`，因为后者不支持 POST）：

```ts
// app/composables/useChat.ts 核心逻辑
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ provider, model, messages })
})

const reader = response.body!.getReader()  // 拿到 ReadableStream reader
const decoder = new TextDecoder()          // 字节 → 字符串

while (true) {
  const { done, value } = await reader.read()
  if (done) break

  const chunk = decoder.decode(value, { stream: true })
  // 手动解析 SSE 行：\n 分割 → 找 "data:" 开头 → JSON.parse
  // → 区分 text / tool_call / error / done / heartbeat
}
```

**为什么 `fetch` 而不是 `EventSource`**：
- `EventSource` 只支持 GET，不支持 POST（你需要传 messages body）
- `EventSource` 不支持自定义 headers（你需要传 `Content-Type`）
- `TextDecoder.decode(..., { stream: true })` 的 `stream` 参数用于处理多字节字符被截断在字节块中间的边界情况

---

## 3. 三个落地场景验证

### 场景 1：文件上传 + 流式分析

完整链路：

```
前端                    后端                         LLM
─────────────────────────────────────────────────────────
① 用户选择文件
② 上传 →           ③ 接收文件
                    ④ 解析文件（PDF/DOCX/TXT/图片）
                    ⑤ 提取文本内容
                    ⑥ 拼装到 messages 数组
                    ⑦ 发送给 LLM ──────────────▶  ⑧ 理解文件内容
                    ⑨ 获得流式响应  ◀──────────  ⑨ 生成回复
⑩ 流式渲染  ◀──    ⑩ SSE 推送
```

**关键细节**——文件内容怎么拼进 messages？

```ts
// 后端做的事
const fileContent = await parseFile(uploadedFile) // PDF → 纯文本
const messages = [
  { role: 'system', content: '你是文件分析助手...' },
  { role: 'user', content: [
    { type: 'text', text: '请帮我分析这份文件' },
    { type: 'text', text: `文件内容：\n${fileContent}` }  // ← 拼在这里
  ]}
]
```

**前端不是"不需要"，而是角色变了**——它只管文件选取和 SSE 消费。真正的解析和拼装全部在后端。这个场景在 Phase 4（RAG）自然覆盖。

### 场景 2：知识库

> "没有数据库和后端，知识库就无根" —— 完全准确。

| 知识库能力 | 依赖什么 | 为什么前端做不到 |
|-----------|---------|-----------------|
| 文档持久存储 | PostgreSQL | 浏览器只有 localStorage |
| 向量相似度搜索 | pgvector 索引 | 向量计算在数据库层 |
| 文档分块解析 | 服务端文件解析库 | 需要解析 PDF/DOCX/HTML |
| Embeddings 生成 | Embeddings API | API Key 不能暴露在前端 |
| 混合检索 | 服务端全文+语义融合逻辑 | 数据库查询只能在服务端 |

知识库的本质是：**把用户的知识变成 LLM 可检索的上下文**。每一步都需要服务端。对应 Phase 4 的 `server/services/rag/`（chunker → embeddings → retriever）。

### 场景 3：传统项目管理系统 + AI

这是 AI 应用最有价值的落地方向。

**传统 BI 能做什么**（结构化字段聚合）：

```sql
-- ✅ SQL 天然擅长
SELECT assignee, COUNT(*) FROM bugs WHERE resolved_at > NOW() - INTERVAL '3 months' GROUP BY assignee
-- → "张三上个月关闭了 15 个缺陷"
```

**传统 BI 回答不了的**（答案在非结构化文本中）：

| 问题 | 为什么 SQL 回答不了 |
|------|-------------------|
| "最近半年反复出现的同类型缺陷有哪些？" | "同类型"不在字段里，在 description 的语义里 |
| "哪些任务多次返工？原因是什么？" | "返工"是评论里"打回重做"的语义，不是字段 |
| "某个需求反复变更范围的根本原因？" | "范围变更"散落在描述的历史版本和评论中 |
| "团队最棘手的三个技术债是什么？" | "技术债"这个概念不存在于任何字段 |

**关键洞察**：传统 BI 只能算"已经有了的字段"。真正有价值的问题，答案藏在**非结构化文本**里。

**AI + 向量数据库怎么解决**：

```
① 所有文本（需求描述、任务评论、缺陷复现步骤）→ Embeddings → pgvector

② 用户问："最近半年有没有同一类缺陷反复出现？"

③ 问题 → Embedding → 向量相似度搜索 → 找出语义相关的缺陷聚类

④ 把这些缺陷的 description + 时间 + 责任人 拼成 context

⑤ 发给 LLM 做聚类分析 → 返回根因推断 + 改进建议
```

**这完整验证了项目架构**：

```
你的核心平台                        TAPD 数据分析场景（一个垂直插件）
──────────────────────────        ──────────────────────────────
多模型对话 (Phase 1)      →      用户自然语言提问界面
Skills 系统 (Phase 2)      →      "数据分析师" Skill + 分析框架
Agent Runtime (Phase 2)   →      工具调用 + 多步推理
MCP 协议 (Phase 3)        →      连接 TAPD API，拉取实时数据
RAG 管道 (Phase 4)        →      向量化存储缺陷/任务描述
垂直场景插槽 (Phase 3+)    →      TAPD 专属 UI（趋势图 + AI 分析）
```

---

## 4. 开发顺序的价值再验证

按照 [scaffold-guide](2026-05-31-scaffold-guide.md) 的开发顺序：

```
数据库 Schema → LLM Provider → SSE 工具 → /api/chat → 对话 CRUD → Chat UI → 暗黑模式
```

这个顺序之所以正确，是因为它遵循数据流动的方向：

> **LLM → Provider → SSE → API → Composable → 组件**

每一步都是下一步的充分条件：
- Provider 调通了（curl 看到流式输出）→ `/api/chat` 才有数据源
- `/api/chat` 返回正确 SSE → `useChat` 才有东西消费
- `useChat` 消息状态正常 → UI 渲染才有意义

**反过来**：先写 UI → 发现连不上后端 → mock 数据 → UI 调好了 → 写 API 发现流式格式不兼容 → 回头改 composable → 发现最复杂的根本不是 UI。

---

## 相关文档

- [2026-05-31 开发思维转变](2026-05-31-mindset.md) — 为什么必须后端优先
- [2026-05-31 项目初始化指南](2026-05-31-scaffold-guide.md) — 分步操作手册
- [ADR-008: Vercel AI SDK 不集成决策](../decisions/008-vercel-ai-sdk.md)
- [ADR-009: 国内模型 API 兼容性调研](../decisions/009-model-compatibility.md)
- [2026-06-03 SSE 工具实现](./2026-06-03-sse-implementation.md) — 四段流式模型的实际代码落地
- [Web Streams API 详解](../learning-notes/web-streams-api.md) — ReadableStream、TextEncoder、Response 等核心原语的项目级用法
- [架构设计](../../.claude/plan/architecture.md) — 完整架构图
