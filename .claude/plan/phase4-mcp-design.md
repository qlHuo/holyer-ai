# Phase 4A：MCP 接入技术设计

> 日期：2026-10-19 · 状态：🔄 设计定稿，待实施
>
> 概念背景：[MCP 概念澄清](../../docs/dev-log/2026-10-18-mcp-concept-clarification.md) — 工具调用 / MCP / ExecutableTool 的边界，以及 2026-07-28 规范的无状态化。

---

## 1. 目标

把外部 MCP Server 提供的工具接入现有 Agent 工具系统：

- 模型像使用内置工具一样使用 MCP 工具；
- 用户能在管理页配置 Server、查看工具、启用/禁用；
- **Agent 运行时（ReAct 循环、Provider 层、SSE 协议）不做结构性改动**。

MCP 在这里只是工具的第二个来源。它的价值是接入我们不想自己实现的第三方能力，不是替换已有内置工具。

---

## 2. 范围

### 本期做

| 项 | 内容 |
|---|---|
| 传输 | Streamable HTTP 单端点 |
| 协议 | 2026-07-28 现代格式 + legacy 握手降级 |
| 原语 | 仅 `tools` |
| 配置 | Server CRUD、连通性探测、工具快照、手动刷新 |
| 运行时 | 请求级工具注册表、MCP 工具适配 |
| 提示词 | PromptSegment 抽象 |
| 管理端 | MCP Server 管理页 |

### 本期不做

- `resources` / `prompts` 原语
- MCP Apps / 生成式 UI
- stdio 传输
- 旧的双端点 HTTP+SSE 传输
- OAuth / CIMD
- 按对话或智能体的作用域（当前无智能体概念）
- 多用户隔离（`user_id` 仍为预留列）
- 写操作的人工审批

---

## 3. 主流程

### 3.1 全景

```
【管理侧】                                  【对话侧】
添加/编辑 Server                             读取启用的 Server 快照（DB）
      │                                            │
      ├─ 测试连接 ──→ 远程 tools/list               ├─ 快照 → ExecutableTool
      │                                            ├─ 请求级 ToolRegistry
      └─ 保存配置 + 工具快照（DB）                   └─ 注入 ChatOptions.tools
                                                         │
                                                         ▼
                                                    LLM 决策 tool_calls
                                                         │
                                                         ▼
                                              registry.get(映射名)
                                                         │
                                                         ▼
                                         MCPClient.callTool(原始名) → 外部 Server
                                                         │
                                                         ▼
                                         结果转文本 → role:'tool' 消息 → 下一轮
```

**两条关键边界**：

1. 管理侧负责"这个 Server 有哪些工具"，产出**快照**；
2. 对话侧只读快照，**不在聊天路径上做远程工具发现**。

### 3.2 流程一：接入与刷新（管理侧）

```
用户填写：name / slug / url / headers / enabled
        │
        ▼
POST /api/mcp/servers/probe  （不落库）
        │  ① URL 静态校验 + SSRF 拦截
        │  ② McpClient 探测：server/discover → 现代 tools/list → legacy initialize
        │  ③ 校验 JSON-RPC 信封与 tools 结构
        ▼
返回：协议版本 / Server 信息 / 工具清单 / 失败原因分类
        │
        ▼
保存（或刷新）：写入配置 + 工具快照 + 协议版本 + 抓取时间
```

原则：

- **探测与保存分离**，用户可以先验证再保存；
- **快照是对话侧的唯一数据来源**；
- 刷新失败时保留旧快照，只更新 `lastError`；
- 工具级开关按原始工具名保存，刷新后清理已消失的项。

### 3.3 流程二：对话装配

```
已启用 Server（一次 DB 查询）
        │
        ├─ 过滤 disabledTools
        ├─ 每个工具 → createMcpTool(server, snapshot)
        ▼
createToolRegistry([内置工具, ...MCP 工具])
        │
        ▼
runAgentLoop(provider, messages, options, registry)
```

失败策略：

- DB 读取失败 → 记录日志，退回"仅内置工具"；
- 单个 Server 数据非法 → 跳过该 Server；
- 快照为空 → 该 Server 不贡献工具，不报错。

### 3.4 流程三：工具调用

```
LLM 返回 tool_calls（映射名：weather__get_weather）
        │
        ▼
registry.get(映射名) → 找到 ExecutableTool
        │
        ▼
adapter 还原原始工具名 get_weather
        │
        ▼
McpClient.callTool("get_weather", args)
        │  JSON-RPC POST，超时与取消信号合并
        ▼
content[] → 文本（截断）
        │
        ├─ 正常 → 字符串结果
        └─ isError → 抛 McpToolError → runner 标记 success=false
        ▼
runner 落库 + SSE tool_end → 进入下一轮
```

模型看到的是**映射名**，调用时 adapter 还原为**原始名**。这个映射只存在于当前请求的工具实例中。

### 3.5 流程四：系统提示词装配

```
buildPrompt([
  user           用户选择的 Prompt
  date           当前时间（显式 UTC+8）
  tool-usage     内置工具调用准则
  mcp:<slug>     每个 Server 一行用途说明（可空）
])
```

约束：

- 顺序稳定，所有集合按固定键排序，避免 prompt cache 失效；
- MCP 段落只写"何时使用该 Server 的工具"，不重复工具描述；
- 所有 MCP 段落总长度设上限，超出时只列 Server 名。

---

## 4. 模块设计

### 4.1 目录

```
server/service/mcp/
  types.ts           # ServerConfig / ToolSnapshot / ProbeResult
  client.ts          # MCP 协议客户端（JSON-RPC + 传输 + 版本降级）
  probe.ts           # 连通性探测（复用 client）
  servers.ts         # 配置 CRUD + 快照读写
  tool-adapter.ts    # ToolSnapshot → ExecutableTool

server/service/system-prompt/
  types.ts           # PromptSegment
  build.ts           # buildPrompt
  segments.ts        # 各 segment 构造函数

server/utils/
  url-safety.ts      # 从 web-fetch.ts 抽出的内网地址判断

server/api/mcp/
  servers/index.get.ts / index.post.ts
  servers/[id].put.ts / [id].delete.ts
  servers/probe.post.ts
  servers/[id]/refresh.post.ts
  schema.ts

app/pages/mcp.vue
app/stores/mcp.store.ts
app/api/mcp.ts
app/components/mcp/*
```

### 4.2 分层职责

| 层 | 只负责 | 不负责 |
|---|---|---|
| `client.ts` | 协议、传输、握手、错误映射 | 工具语义、DB |
| `tool-adapter.ts` | 命名空间、schema 清洗、结果拍平 | 网络请求 |
| `servers.ts` | 配置与快照持久化 | 协议细节 |
| `ToolRegistry` | 可用工具集合 | 来源差异 |
| `runner.ts` | ReAct 循环 | 是否 MCP |

### 4.3 核心接口

```ts
// client.ts
export class McpClient {
  discover(): Promise<DiscoverResult>
  listTools(): Promise<McpToolSnapshot[]>
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult>
}
```

```ts
// tool-adapter.ts
export function createMcpTool(
  server: McpServerRow,
  snapshot: McpToolSnapshot
): ExecutableTool
```

```ts
// tools/index.ts
export function createToolRegistry(extra: ExecutableTool[] = []): ToolRegistry
```

```ts
// prompt/types.ts
export interface PromptSegment {
  id: string
  priority: number
  content: string
}
```

### 4.4 协议策略

```
探测顺序：
1. server/discover          → 2026-07-28
2. 现代格式 tools/list      → 2026-07-28
3. legacy initialize + tools/list → legacy

协商结果写入 DB，后续按该模式请求。
```

传输范围：

- ✅ Streamable HTTP 单端点（JSON 或 SSE 响应）
- ❌ 双端点 HTTP+SSE（GET /sse + POST /messages）——探测阶段明确报错

---

## 5. 数据模型

```ts
export type McpToolSnapshot = {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  annotations?: Record<string, unknown>
}

export const mcpServers = pgTable('mcp_servers', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  slug: varchar('slug', { length: 20 }).notNull().unique(),
  url: text('url').notNull(),
  headers: jsonb('headers').$type<Record<string, string>>().default({}).notNull(),
  enabled: boolean('enabled').default(false).notNull(),
  protocolVersion: varchar('protocol_version', { length: 20 }),
  serverInfo: jsonb('server_info').$type<{ name?: string, version?: string }>(),
  tools: jsonb('tools').$type<McpToolSnapshot[]>().default([]).notNull(),
  disabledTools: jsonb('disabled_tools').$type<string[]>().default([]).notNull(),
  toolsFetchedAt: timestamp('tools_fetched_at'),
  lastCheckedAt: timestamp('last_checked_at'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})
```

设计说明：

- **单表 + JSONB 快照**：工具是 Server 的从属数据，无独立生命周期；
- **不做 `scope` 列**：当前全局作用域。将来引入智能体时再加 `agent_id`，迁移成本低；
- **slug 创建后不可修改**：它参与工具命名，改动会让历史消息中的工具名与当前映射错位。

---

## 6. 关键设计决策

| 决策 | 理由 | 否决的替代 |
|---|---|---|
| 只做 tools 原语 | 唯一需要模型决策的原语；resources/prompts 可后续以"工具化"方式加入 | 一期全原语（范围失控） |
| 仅 Streamable HTTP 单端点 | 实现简单、与 Workers 契合；双端点 SSE 已是废弃传输 | 同时支持旧 SSE（复杂度翻倍） |
| 手写 Client，不用 SDK | 只需 2 个方法；无 Edge 打包风险；便于接 SSRF/超时/日志 | 官方 SDK（能力过剩，仍需适配层） |
| 对话只读快照 | 不增加首 token 延迟；单个 Server 故障不影响对话 | 每次对话实时 `tools/list`（延迟与故障放大） |
| 请求级注册表 | Workers isolate 并发共享，全局单例会导致跨请求泄漏 | 继续使用全局单例 |
| 工具名命名空间 | 多 Server 同名工具必须可区分；Provider 名称有限制 | 直接透传原始名（必冲突） |
| 可缓存性 opt-in | 写操作重复执行是正确性事故；只有明确只读才缓存 | 默认缓存（沿用内置工具行为） |
| 全局作用域 | 当前没有智能体/多用户概念；先跑通主链路 | 一期就做会话/智能体级配置 |
| PromptSegment 最小实现 | 解决 MCP 工具描述膨胀，不做插件系统 | 完整提示词编排框架（过度设计） |

---

## 7. 安全边界

| 面 | 设计约束 |
|---|---|
| SSRF | URL 只允许 http/https；拒绝内网/保留地址（含 IPv6 私有段、末尾点、内嵌凭据）；不跟随重定向；限制超时与响应大小；开发环境通过显式开关放行 loopback |
| 外部内容 | 工具描述与结果视为不可信数据；限制描述与结果长度；UI 只做纯文本展示，禁止 `v-html` |
| 写操作 | 本期不做审批流。默认只有 `readOnlyHint` 明确的工具可缓存；非只读工具不参与结果缓存 |
| 密钥 | headers 明文存储（个人项目），API 响应脱敏，日志禁止打印 |
| 工具规模 | 全局上限：Server ≤ 10、工具 ≤ 50；超出拒绝启用 |

---

## 8. 实施拆分

| 阶段 | 内容 | 验收 |
|---|---|---|
| **M0** | PromptSegment 抽象；同步评测脚本；修正 `dateContext` 时区 | 内置工具路径输出与改造前一致；评测脚本可运行 |
| **M1** | `url-safety` 抽取；`McpClient`；probe | 用本地测试 Server 跑通现代/legacy/坏响应三种场景 |
| **M2** | 工具适配 + 请求级注册表 + chat 接入 | 手工配置一条数据后，模型能调用 MCP 工具并正常落库 |
| **M3** | DB 表 + API + 管理 UI | 新增 → 测试 → 保存 → 启用 → 刷新全流程可用 |
| **M4** | 安全与可靠性兜底 | 断网/401/非 MCP 地址有明确提示；坏 Server 不影响对话 |
| **M5** | 真实 Server 验证 + 文档沉淀 | 接入 2 个真实 Server，记录兼容性问题 |

### 验收基线

- [ ] 禁用 Server 后，下一次请求中其工具立即消失
- [ ] 两个 Server 同名工具可被模型正确区分
- [ ] MCP 工具失败时 `success=false`，对话继续
- [ ] 非 MCP 地址、内网地址被拒绝且有可读提示
- [ ] 内置工具行为零回归
- [ ] 单 Server 故障不影响其他 Server 与内置工具

---

## 9. 后续演进

| 方向 | 触发条件 |
|---|---|
| `resources` 工具化 | 接入文件系统 / Notion / GitHub 等带资源的 Server |
| MCP prompts 导入 | 用户希望外部模板进入本地 Prompt 库 |
| 按智能体作用域 | 引入垂直场景后，每个智能体配置自己的 Server/工具集 |
| 写操作审批 | 接入发消息、下单、删除类工具时 |
| MCP Apps | 有外部 Host/Server 真实需求时 |

---

## 10. 说明

本方案聚焦**主流程与模块边界**。以下实现细节在编码阶段确定，并在完成后沉淀到 dev-log，不在方案阶段展开：

- JSON-RPC / SSE 响应解析的具体实现
- JSON Schema 清洗规则与降级策略
- 工具名截断与冲突解决的精确算法
- 错误码映射、重试次数、超时参数
- UI 表单与交互细节

---

## 相关文档

- [MCP 概念澄清](../../docs/dev-log/2026-10-18-mcp-concept-clarification.md) — 三层模型、接入边界、2026-07-28 规范
- [MCP 实现全链路解读](../../docs/dev-log/2026-10-21-mcp-implementation-walkthrough.md) — 4A.0–4A.2 落地后的逐步 trace 与数据形状变化
- [Phase 2 Agent 设计方案](phase2-agent-design.md) — Agent Runtime 与工具系统
- [Agent 工具系统实现详解](../../docs/dev-log/2026-07-29-agent-tool-system-implementation.md) — `ExecutableTool` / `ToolRegistry`
- [Agent ReAct 完整流程](../../docs/dev-log/2026-08-05-agent-react-full-flow.md) — 工具调用循环
- [实施路线图](roadmap.md) — Phase 4 拆分
- [项目进度](status.md)
