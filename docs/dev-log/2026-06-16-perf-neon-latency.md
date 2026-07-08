# 2026-06-16 — 接口性能诊断：Neon 延迟与串行查询

> 本地开发接口很慢的排查结论：Neon US East 区域 + 代码串行查询叠加，chat 接口 DB 前置延迟 1.2–2s。迁移新加坡不可行（路由比美国还差）。并行化查询是有效的优化手段，本地 PostgreSQL 后续再评估。

---

## 讨论背景

本地 `npx nuxi dev` 调试时接口明显卡顿。怀疑是 Neon 数据库的原因，需要系统排查并给出解决方案。

---

## 核心结论

### 1. 延迟来源：Neon 区域 + 串行查询叠加

当前 Neon 项目在 **AWS US East (N. Virginia)**，从中国国内每次 HTTP 查询往返 200–350ms。

`POST /api/chat` 在 LLM 调用前有 **4 次串行 DB 查询**：

```
getConversation()          ████████████  ~300ms
getHistory()               ████████████  ~300ms   ← 互不依赖但串行
INSERT user message        ████████████  ~300ms
UPDATE updated_at          ████████████  ~300ms   ← 同上
                          ────────────
合计 ~1200ms（纯 DB 等待，用户看到的是"点了没反应"）
```

对应代码：
- [queries.ts:97-110](server/service/conversation/queries.ts#L97-L110) — `getConversationDetail` 串行调用 `getConversation` + `getHistory`
- [mutations.ts:100-130](server/service/conversation/mutations.ts#L100-L130) — `addMessages` 用 `for` 循环逐条 INSERT + 后置 UPDATE

### 2. 为什么新加坡比美国更慢

尝试将 Neon 迁到 `ap-southeast-1`（新加坡），结果直接超时。原因是中国国际网络出口的路由特性：

| 方向 | 路由 | 质量 |
|------|------|------|
| 中国 → 美西 | TPE/NCP 直达海缆，带宽 Tbps 级 | 200ms 但**稳定** |
| 中国 → 东南亚 | 经香港 → 越南 → 泰国 → 新加坡，跳数多、带宽小、易拥堵 | 理论上 80ms，实际**超时/高丢包** |

关键洞察：**从中国出发，物理距离 ≠ 网络延迟**。AWS 新加坡的 `18.138.x.x` IP 段可能被运营商 QoS 限速。

### 3. 代码优化机会（未实施，已确认方案）

三个无依赖的串行调用可以并行化：

| 位置 | 现状 | 并行后效果 |
|------|------|------|
| `getConversationDetail` | 2 次串行 | 1 次等待 |
| `addMessages` | N 条 INSERT + 1 UPDATE 全串行 | 1 次等待 |
| `deleteConversation` | SELECT + DELETE 串行 | 1 次等待 |

改动量：3 个函数，约 15 行代码。并行化后，US East 下 chat 接口 DB 前置从 1200ms → ~300ms（1 次等待）。

### 4. 生产环境预估

本地开发慢不影响上线。部署到 Cloudflare Workers 后，Worker 和 Neon 都在云端骨干网上，单次查询 5–15ms。并行化后 chat 接口 DB 开销可压在 20ms 以内，瓶颈完全转移到 LLM 首 token。

### 5. 本地 PostgreSQL 方案（已讨论，暂缓）

方案是 dev 环境切到本地 PostgreSQL（Docker 或直装），`server/db/index.ts` 做环境自动切换（dev 用 `postgres-js`，prod 用 `neon-http`）。彻底消除网络延迟。本机未安装 Docker 和 PG，用户决定后续再处理。

---

## 关键洞察

- **Neon 区域的"快慢"从中国看不是直觉判断**：新加坡在地理上更近，但网络路由质量远不如北美。选区域时不能看物理距离，要实测
- **串行查询是隐形成本**：开发阶段单次查询 300ms 不觉得慢，但 4 次叠在一起就变成秒级。写代码时"无依赖就并发"是个好习惯
- **本地和生产是两套网络拓扑**：本地是中国 → Neon，生产是 CF Worker → Neon（骨干网）。本地慢不代表上线慢，反之上线快不代表本地不用优化
- **优选域名/DNS 策略只解决用户到 CF 边缘这半程**，Worker 到 Neon 这后半程不受影响

---

## 相关文档

- [ADR-003: Neon PostgreSQL + Drizzle ORM](../decisions/003-neon-drizzle.md) — 为什么选 Neon，提到了"跨云网络延迟"但未展开本地开发场景
- [ADR-004: Cloudflare Workers 部署](../decisions/004-cloudflare-pages.md) — 生产部署架构，Worker ↔ Neon 通信路径
- [对话持久化设计](2026-06-03-conversation-persistence-design.md) — 对话 CRUD 和 chat 改造的实现细节
- [SSE 实现](2026-06-03-sse-implementation.md) — SSE 流式工具，与本讨论的 chat 接口性能直接相关
