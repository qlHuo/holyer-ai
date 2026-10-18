# 2026-10-18 — MCP 概念澄清：工具调用、协议与接入边界

> 核心洞察：**MCP 不是"工具调用"，而是工具能力的来源标准。** 两者在 `ExecutableTool` 上汇合，但分属两条独立的协议边界。把 MCP 理解成"动态版的内置工具"能帮你做对实现，但不能帮你做对接入边界的判断。

---

## 讨论背景

Phase 4 = MCP 开工前。此前对 MCP 的直觉理解是"接入一个 HTTP 接口"，由此产生了一连串疑问：

- MCP 和工具调用到底是什么关系？实现 MCP 要改造 `ExecutableTool`，是不是说明工具调用就是 MCP 的核心？
- web_search 能不能改成 MCP 接入？
- 管理页面是不是填个 HTTP 地址和参数就行？
- 所有客户端的 MCP 实现是不是完全一样？

这些问题的共同根源是**把三个层次叠成了一层**。本文记录澄清后的概念模型，不涉及具体实现（实现方案见 Phase 4 开工时另立文档）。

---

## 一、三层模型：工具调用、MCP、ExecutableTool

| 层 | 回答的问题 | 协议边界 |
|---|---|---|
| **工具调用**（function calling） | 模型如何表达"我要执行 X，参数是 Y" | LLM ↔ Agent Runtime |
| **MCP** | Runtime 如何发现并执行外部能力 | Agent Runtime ↔ Server |
| **ExecutableTool** | 项目内部"一个可调用动作"长什么样 | 纯内部抽象，不属于任何协议 |

```
内置工具（手写）        ──┐
                          ├─→ ExecutableTool ─→ ToolDefinition ─→ 模型 tools 参数
MCP 工具（运行时适配）  ──┘        ↑
                              MCP 只是多了一个"生产来源"
```

关键事实：**模型永远不知道 MCP 存在。** 它只看到一串扁平的 `ToolDefinition`，按工具名决策。至于是内置工具还是 MCP 工具，是 Runtime 的事。

因此 MCP 的准确定位是**消费端的供给标准**：

- 工具调用负责"怎么用"（交互协议）；
- MCP 负责"从哪来"（供给协议）。

类比：工具调用是"顾客点菜"，MCP 是"厨房按统一标准从供应商进货"，`ExecutableTool` 是"菜单条目"。改造菜单系统让供应商能直连，不等于"点菜就是供应链"。

---

## 二、五个常见误解与纠正

### 误解 1：MCP 就是工具调用

**纠正**：`tools` 是 MCP 的主干原语，但不是全部。MCP 还有 `resources`（只读上下文）和 `prompts`（模板），这两者**不需要**经过模型决策，可以不变成工具。把 MCP 等同于工具调用，会漏掉这两类能力。

### 误解 2：既然要改造 ExecutableTool，说明工具调用就是 MCP 核心

**纠正**：`ExecutableTool` 接口本身几乎不用改——它已经是 `execute(): Promise<string>`，也留了 `signal` 和 `ctx` 扩展点。真正卡住 MCP 的是**工具注册的生命周期**：

- 现在：模块级全局单例 + import 时静态注册四个内置工具；
- MCP 需要：按用户配置、按会话启用、数量可变的动态工具。

在 Cloudflare Workers 这种 isolate 被并发请求共享的环境里，往全局单例塞用户工具会造成**跨用户泄漏**。所以要改的是"全局单例 → 请求级注册表"，这是作用域问题，不是工具调用机制问题。

### 误解 3：MCP 就是调 HTTP 接口

**纠正**：传输层确实是 HTTP，但实现的是**协议**。普通 HTTP 接口要你为每个服务写死 adapter；MCP 通过 `tools/list` 在运行时发现工具，一个客户端接所有 Server。差异类似"写网页爬虫"和"实现数据库驱动"。

### 误解 4：管理页面填个 HTTP 地址和参数就能接

**纠正**：地址必须**本身就说 MCP**。普通 REST API 必须有人给它套一层 MCP Server 外壳——这个外壳可以在本项目、独立 Worker，或由第三方托管，但不能凭空自动生成。

管理页面实际配置的是：显示名、Slug（工具命名空间前缀）、MCP 地址、认证头、启用状态、可选的工具白名单。**参数不由用户填**，`inputSchema` 来自 `tools/list`。

### 误解 5：所有客户端的 MCP 实现完全一样

**纠正**：**wire 格式统一，客户端能力不统一。**

| 层面 | 是否统一 |
|---|---|
| JSON-RPC 方法名、参数、返回结构 | ✅ |
| 传输方式（stdio / Streamable HTTP） | ✅ 协议统一，但各客户端支持子集 |
| 支持的规范版本 | ❌ 存量客户端差异明显 |
| 支持哪些原语 | ❌ 有的只支持 tools |
| 工具如何注入模型 | ❌ 全量 / 渐进发现 / 元工具，各自决定 |
| 鉴权方式 | ❌ 无鉴权 / Bearer / OAuth 2.1 |

结论：Server 写一次理论上所有客户端可用，实际要确认对方支持的传输和版本。

---

## 三、完整链路（概念层）

```
【装配，在 LLM 之前】
1. 读取用户启用的 MCP Server 配置
2. tools/list 拉取工具清单           ← 此时 LLM 尚未参与
3. 适配成 ExecutableTool
4. 组装请求级工具注册表

【决策】
5. 工具定义随请求发给 LLM
6. LLM 返回 tool_calls（只认工具名）

【执行】
7. Runtime 按名字找到对应工具
8. tools/call 执行（MCP 工具此刻才发生网络请求）

【回填与循环】
9. 结果写成 role: 'tool' 的消息（带 toolCallId）
10. 再次请求 LLM → 回到第 5 步，直到模型不再调用工具
```

两个易错点：

1. **`tools/list` 在 LLM 之前**。没有它，模型不知道有哪些工具可选。
2. **模型选择的是"工具名"，不是"MCP Server"**。Server 的选择发生在装配阶段；工具名冲突由客户端用 `serverSlug__toolName` 命名空间解决。

另外，`tools/call` 的响应是**工具调用的结果**，不是"再发起一次调用"。它作为 `tool` 消息回填后，模型继续推理。

---

## 四、接入边界：什么时候值得用 MCP

MCP 的设计不关心两端部署在哪。**判断标准不是"是不是远程"，而是边界是否真实存在**——所有权、发布周期、客户端多样性。

| 场景 | 做法 | 理由 |
|---|---|---|
| 自己写的能力，只给自己用 | 内置工具 | 没有边界，MCP 只是多绕两层 |
| 自己的能力，还要给 Claude / VSCode 等使用 | 内置工具 + 额外暴露 MCP Server | 边界在"本应用 vs 其他客户端" |
| 接入第三方能力 | MCP Client | 边界在"自己 vs 别人" |
| 团队 A 提供、团队 B 消费 | MCP | 边界是所有权和发布节奏 |
| 本机文件系统等工具 | stdio MCP Server | 同机但进程和生命周期独立（本项目 Edge 环境不可用） |

由此可得两个结论：

- **自研工具继续自研**。已经跑通、可调优的 web_search 换成 MCP 没有收益，反而失去结果格式控制、增加一跳网络和故障点。
- **"一个能力，两个出口"是常态**。自己的应用用内置工具，同时把能力暴露成 MCP Server 给外部客户端，两者不矛盾。

---

## 五、协议现状：2026-07-28 已无状态化

调研时发现一个关键的时效信息：**2026-07-28 是已发布的稳定版**，取代 2025-11-25，是协议诞生以来最大的一次系统性改写（无状态核心）。旧版本有 12 个月弃用窗口。

| 变化 | 内容 | 对本项目的意义 |
|---|---|---|
| 移除握手 | 新模型不再使用 `initialize` / `notifications/initialized`（旧协议版本仍保留以兼容存量客户端） | 客户端更简单 |
| 移除会话 | 不再有 `Mcp-Session-Id` | **与 Workers 无状态环境天然契合** |
| 移除 SSE 续传 | 不再有 `Last-Event-ID`，断流即重发请求 | 传输层更简单 |
| 请求自描述 | `params._meta` 中 `io.modelcontextprotocol/protocolVersion`（必填）、`.../clientCapabilities`（必填）、`.../clientInfo`（可选）；响应侧带 `serverInfo` | 无状态的同时保留版本协商 |
| 结果判别 | 每个结果必须带 `resultType`：`"complete"` 或 `"input_required"`；旧服务端缺省按 `complete` 处理 | 解析层需新增判别分支 |
| 发现接口 | `server/discover`：**服务端 MUST 实现**，客户端可选调用 | 可用于探测支持的版本与能力 |
| 请求头 | `MCP-Protocol-Version`、`Mcp-Method` 每个 POST 必带；`Mcp-Name` 仅在 `tools/call`、`prompts/get`、`resources/read` 等有子目标的请求中必带 | 服务端校验头与 body 一致 |
| 缓存提示 | list 类结果带 `ttlMs` / `cacheScope`；`ttlMs` 缺省视为 `0`（立即过期），`input_required` 结果不可缓存 | 决定 `tools/list` 能否缓存、缓存多久 |
| 多轮交互 | 服务端发起请求改为 MRTR：返回 `input_required` + 不透明 `requestState`，客户端带 answers 重试 | 本项目暂不涉及，但解析时不能当成错误 |
| 版本协商 | 版本不兼容返回 `-32022 UnsupportedProtocolVersionError`，`data.supported` 给出支持列表 | 客户端降级逻辑的依据 |
| 原语调整 | Roots / Sampling / Logging 废弃；OAuth 动态客户端注册改为 CIMD | 简化实现面 |
| 旧传输废弃 | HTTP+SSE 正式标记 Deprecated，统一走 Streamable HTTP | 项目文档里的 "HTTP/SSE" 是旧叫法 |

**兼容性现实**：大量存量 Server 仍在 2025 版本（有握手、有会话）。客户端要么做版本降级，要么使用官方 SDK 的自动协商模式。官方建议在 stdio 场景先用 `server/discover` 探测，因为 stdio 没有 HTTP 状态码可用。

> **核对记录（2026-10-18）**：以上结论已通过官方 changelog / versioning / caching / discover 页面与多个 SDK 文档交叉核对，确认 2026-07-28 为稳定版、`_meta` 键名、请求头规则、`resultType` 与缓存字段。仍未逐字确认的细节：头与 body 不一致时返回的具体 JSON-RPC 错误码（社区实现中出现 `-32001`，此前的 `-32020` 说法未能证实），实现时以官方规范页面为准。

**协议信封是固定的，业务内容是自由的**：`result` / `error` 的结构由协议规定，不能自创；但 `tools/call` 返回的 `content[].text` 放什么由工具作者决定——它是给模型读的，应该放可读文字而非原始 JSON。

还要区分两种错误：协议错误走 `error` 字段，**工具执行失败走 `result.isError: true`**。后者让模型能看到失败原因并自行重试。

---

## 六、对 Phase 4 的含义

1. **核心工作量不在"改造工具接口"**，而在：通用 JSON-RPC 客户端、请求级注册表、管理界面与配置存储。
2. **管理页面只接受 MCP 端点**。"任意 REST 接口"不是 MCP；若将来要支持，应作为独立的"自定义 HTTP 工具"功能，不要混在同一入口。
3. **验证地址是否合规没有官方注册表**，只能主动探测：发最小请求 → 校验 JSON-RPC 信封 → 校验 `tools` 数组与 `inputSchema`。失败要按原因分类提示（401 / 404 / 返回 HTML / 无 `jsonrpc` / 无 `tools/list` / 工具为空）。
4. **探测必须在服务端做**，因为绝大多数 MCP Server 不返回 CORS 头；同时这是 SSRF 高风险面，需复用项目现有的内网地址拦截，并禁止跟随重定向、限制超时与响应大小。
5. **自己写一个 MCP Server 很小**：本质就是一个处理 `tools/list` 与 `tools/call` 的 POST 路由。它的真正价值是让外部客户端复用你的能力，而不是给自己用。

---

## 关键洞察

- **模型永远不知道 MCP 存在**——它只见工具名；MCP 是 Runtime 与外部能力之间的供给协议。
- **`ExecutableTool` 是缝，不是协议**。改它不是为了"支持工具调用"，而是为了容纳动态来源。
- **`tools/list` 发生在 LLM 之前**，否则模型无从选择。
- **MCP 的价值来自跨边界，而非功能本身**。只给自己用的能力，内置工具是更短的路。
- **2026-07-28 的无状态化消除了本项目最大的实现障碍**——不再需要维护会话，天然匹配 Workers。
- **验证 MCP 地址 = 探测，不是查询**。没有目录服务，只能看对方是否按协议回话。

---

## 相关文档

- [Phase 4 路线图](../../.claude/plan/roadmap.md) — MCP Client / 管理界面 / 垂直场景
- [架构设计 · MCP Client](../../.claude/plan/architecture.md) — 接口草案（注意其中的 "HTTP/SSE" 为旧叫法）
- [Agent 工具系统实现详解](2026-07-29-agent-tool-system-implementation.md) — `ExecutableTool` 与 ToolRegistry 的由来
- [Agent ReAct 完整流程](2026-08-05-agent-react-full-flow.md) — 工具调用循环的现有实现
- [Web 搜索工具后端选型](2026-08-04-web-search-backend-selection.md) — 一个成熟内置工具的形态，作为"MCP vs 内置"的对照
- [Phase 2 全链路审查](2026-08-18-phase2-review.md) — SSRF 防护的现状与边界
- [CodeGraph 接入](../claude-tips/codegraph.md) — 项目中已有的第三方 MCP 客户端使用实例
