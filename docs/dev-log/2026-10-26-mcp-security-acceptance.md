# MCP 安全与可靠性验收（4A.4）

> 日期：2026-10-26 · 范围：Phase 4A.4 + 设计文档 §8 全部验收基线 · 结论：**全部通过**

---

## 1. 背景

4A.0–4A.3 与 4A.5（高德真实接入）完成后，4A.4 的机制（SSRF、超时、结果截断、失败隔离、工具上限）已在 4A.1–4A.3 的实现中同步落地，但从未做过端到端验收，因此 roadmap 一直停留在 ⬜。

本次验收的目标不是补代码，而是**证明这些机制在真实请求链路上生效**，并把结果记录下来，让 4A.4 可以关闭。

---

## 2. 环境

| 项 | 说明 |
|---|---|
| 应用 | 本地 `nuxi dev`（HTTPS 自签，loopback 由 `import.meta.dev` 自动放行） |
| 数据库 | 本地 Docker PostgreSQL + pgvector；migration 0000–0004 已全部应用 |
| 正常 MCP Server | `POST /api/dev/mcp/modern`（echo / get_weather / always_fail，含 `readOnlyHint`） |
| 坏响应 Server | `POST /api/dev/mcp/broken`（返回 HTML） |
| 401 / 超时 Server | `https://httpbin.org/status/401`、`https://httpbin.org/delay/15` |
| 不可达 Server | `https://no-such-mcp-host.invalid/mcp` |

> 全程走管理 API（`/api/mcp/servers/*`）与真实对话（`/api/chat`），不直接调用 Service，也不改代码。
> 所有临时 Server 与测试对话在脚本 `finally` 中删除，验收后 DB 恢复为原有 2 个 Server。

---

## 3. 验收结果

### 3.1 探测与错误映射

| 场景 | 实际返回 | 结论 |
|---|---|---|
| 返回 HTML 的非 MCP 地址 | `not-mcp`：「响应不是合法 JSON，可能不是 MCP Server」 | ✅ |
| 404 地址 | `not-found`：「该地址不存在，MCP 端点通常以 /mcp 结尾」 | ✅ |
| 401 | `auth`：「需要认证，请填写正确的请求头」 | ✅ |
| 内网地址 `192.168.1.1` | `invalid-url`：「出于安全考虑，不允许访问内网或保留地址」 | ✅ |
| 不存在域名 | `unreachable`：「无法连接到该地址，请检查网络或地址」 | ✅ |
| `delay/15`（超 10s 单请求超时） | `timeout`：「连接超时，请检查地址或稍后重试」，实测 **10.06s** 返回 | ✅ |

错误文案均直接来自 `ProbeErrorKind` 映射，前端无需二次翻译。

### 3.2 配额

| 场景 | 实际 | 结论 |
|---|---|---|
| 已有 15 个启用工具（高德）时再存 36 工具 Server | 400：「启用的 MCP 工具总数不能超过 50 个（当前将达 51 个）」 | ✅ |
| 存 35 工具 Server（合计正好 50） | 200，实际启用工具数 = 50 | ✅ |
| 工具级开关禁用 35 个后恢复 | 200，disabledTools 长度 35 → 0 | ✅ |
| 已满 10 个 Server 时新建第 11 个 | 400：「MCP Server 数量已达上限（10 个）」 | ✅ |

配额同时覆盖 `enabled` 新建、`PATCH` 启停、`refresh` 三条写入路径。

### 3.3 运行时（真实对话）

| 场景 | 实际 | 结论 |
|---|---|---|
| 模型调用 `devmcp__always_fail`（Server 返回 `isError`） | SSE `tool_end.success=false`，随后继续生成最终回答并 `done` | ✅ |
| 调用不可达 Server 的工具 | `success=false`，结果文本「工具执行异常：无法连接 MCP Server：fetch failed（ENOTFOUND）」回填模型，对话正常结束 | ✅ |
| 禁用 Server 后发起下一次请求 | dev 日志 `[mcp] Servers=2, tools=…` 中该 Server 的全部工具立即消失 | ✅ |
| 两个 Server 各暴露同名 `echo` | 映射为 `devone__echo` / `devtwo__echo`，两次调用均成功且返回各自参数 | ✅ |
| 保留坏 Server 启用时正常对话 | 请求正常返回 `meta`，其他 Server 与内置工具不受影响 | ✅ |
| 内置工具回归（calculator） | `123 * 456 = 56088`，工具成功、回答正确、`done` | ✅ |

两条失败路径分开验证：`isError`（业务失败，`McpToolError`）与传输失败（`McpError`），runner 都标记 `success=false` 而不中断循环。

---

## 4. 未覆盖 / 已知边界

- **DB 读取失败降级**（`loadMcpTools` 退回仅内置工具）只做了代码审查，未构造故障注入；本地无法在不改代码的前提下稳定触发。
- **结果截断（20k 字符）与 Schema 清洗**属于纯函数行为，未在 E2E 中构造超大结果；建议后续随单元测试补。
- **线上环境**：本次只验本地。线上 migration 0004 是否已应用、线上 SSRF 是否不受 `allowLoopback` 影响（`import.meta.dev === false`）需在部署后另行确认。
- 验收脚本是一次性的（临时目录），未入库；如需回归，按上表的请求与提示词复现即可。

## 5. 踩坑

- **SSE 的 `text` 是增量事件**：断言「最终回答包含某数字」必须拼接全部 text 片段，单条事件里可能被切成 `56088` 的两半，否则会误判为失败。
- **Nuxt dev 锁**：同一项目目录已有 dev 进程在跑时，第二个会因 `#acquireDevLock` 直接退出（`.nuxt/nuxt.lock` 记录 PID，进程结束后文件也不会自动删除）。另外本机 dev 默认 HTTPS 且只监听 `[::1]`，用 `curl http://localhost:3000` 探测会全部失败，需 `-k` + IPv6 或 Node fetch 关闭证书校验。

## 6. 结论

4A.4 的安全与可靠性机制全部生效，设计文档 §8 的 6 条验收基线全部通过。Phase 4A 的实现工作至此收尾，剩余只有线上 migration 0004 的确认与部署后复查。
