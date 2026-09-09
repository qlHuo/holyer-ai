# 2026-09-09 — GitHub 文档引入（roadmap 3.7 / M4）：需求定稿与实施方案

> 核心洞察：一次把「GitHub 仓库的一批 .md」变成可检索的知识库内容；「覆盖」策略让批量导入从一次性灌入升级为可重复的**同步能力**。MVP 只服务公开仓库——浏览器直连、零 token、绕开 CF 配额，代价是私有仓库走 CLI 备退路。

---

## 讨论背景

[09-02 阶段 B 实施方案](2026-09-02-rag-phase-b-implementation.md) 的 M4 里程碑只给了骨架：浏览器编排、相对图 URL 改写、逐条复用上传 API。本文是 M4 开工前的**需求定稿与详细方案**——经多轮澄清，把"公开/私有"边界、来源标记语义、重名冲突语义、批量交互形态、图片处理范围等此前悬而未决的点全部拍板。

**MVP 边界**：只支持**公开仓库 + markdown 文本**。明确不做：私有仓库（走本地 CLI 备退路）、非 md 格式、定时自动同步、断点续传、上传后再改名（需 PATCH 端点，推迟）。

---

## 决策基线（已确认）

| 决策 | 结论 |
|---|---|
| 目标仓库 | **仅公开仓库**，浏览器直连 GitHub（CORS 开放、零 token、绕开 Worker 不耗 subrequest） |
| sourceType | 语义从"格式位"改造为**来源通道**：`local`(灌库脚本) / `github`(引入) / `manual`(手动上传，未来手动新建)；零 DDL |
| 标题 | 默认 `目录前缀 + 文件名去扩展名`（天然跨目录唯一），勾选清单**行内可改名**，改名实时重算冲突 |
| 重名冲突 | 导入前选 **覆盖（默认）/ 跳过**；覆盖 = 后端真 upsert（删旧换新），成为同步能力 |
| 图 URL 改写 | **一并处理**：相对路径 → 绝对 raw URL，入库前完成；不可解析 URL 安全降级为文字 |
| 批量交互 | 串行循环 + **组件级运行态**（弹窗内一次性过程，刷新即弃，非落库任务实体）+ 停止按钮 + 失败分型重试 |
| 清单数量 | 搜索过滤不截断；勾选 >100 提示分批 + 确认弹窗 |

---

## 需求定位与用户可感知的功能

用户场景：大量 markdown 文档维护在 GitHub 仓库（项目 docs、学习笔记仓库、上游文档仓库），要成批沉淀进个人知识库做 RAG 检索，而非逐篇"下载 → 本地上传"。核心价值 = 一批文档一次进库，且重复执行可同步更新。

| # | 功能 | 一句话 |
|---|---|---|
| 1 | 仓库接入与文档发现 | 填 owner/repo 列出全部 md（路径 + 大小），>500KB 预标不可导入 |
| 2 | 选择性批量导入 | 勾选多篇 → 串行逐篇灌入；进度、可停止、失败项单独重试 |
| 3 | 文档标题管理 | 默认"目录/文件名"，导入前可逐行改名，重名实时预警 |
| 4 | 重名冲突策略 | 覆盖（默认）/ 跳过；覆盖 = 旧文档及旧向量被替换 |
| 5 | 图片自动转绝对地址 | 相对图路径 → GitHub raw 直链，检索答案里的图能渲染 |
| 6 | 来源可溯源 | 文档带 `github` 来源标记，列表可见区分（未来按来源筛/溯源的入口） |

---

## 关键设计决策（为什么）

### 1. 为什么只做公开仓库 + 浏览器直连
GitHub 公开数据对浏览器发 `Access-Control-Allow-Origin: *`，raw CDN 同——前端可直连，**Worker 零参与**：列目录整仓只 1 次 trees API（匿名限 60 次/时足够），每篇 raw 拉取不算 API 配额、0 subrequest。私有仓库需要 token，而 token **绝不能进前端代码**（站点公开部署，bundle 人人可读）→ 私有场景走本地 CLI（env `GITHUB_TOKEN` + 复用 ingest），是 [09-02 方案](2026-09-02-rag-phase-b-implementation.md) 已备的退路。

### 2. sourceType：从"格式位"改造成"来源通道"
原列注释"预留格式扩展（PDF/Word）"——但需求已定死**只做 markdown**（明确不做 PDF/Word/Excel/PPT），格式轴实际已死。与其留个永远恒为 'markdown' 的死列，不如改成有信息的**来源通道**：

| 值 | 含义 | 写入方 |
|---|---|---|
| `local` | 本地批量灌库 | `scripts/ingest-docs.ts`（现落 'markdown' 改 'local'） |
| `github` | GitHub 引入 | M4 前端（新增） |
| `manual` | 手动上传 / 未来手动新建 | RagUploadDocumentModal 等手动上传（现落 'markdown' 改 'manual'） |

**为什么不加独立列**：溯源真正要的是"原文件在仓库的 URL + 分支 + commit sha"，不是 'github' 三个字——那是 [3.11 引用溯源](../dev-log/2026-08-19-rag-knowledge-base-design.md) 阶段的事，届时一并设计 `sourceUrl` 类字段，现在加列 = 写迁移换一个没人消费的字段。标题保留目录前缀（`docs/guide`）已是半个溯源线索。
**零 DDL**：列仍是 `varchar(50)`，default 不动；各写入方显式传值即可。唯一要改 schema 的是让上传 API **接收** sourceType（zod `.object()` 默认 strip 未知键）。

### 3. 重名冲突：覆盖策略把导入升级成同步
上传接口原语义"同名即 409"（防向量膨胀），但这使"手动同步"退化：仓库改了文档想重拉 → 全部 409，只能删旧再灌。方案：上传请求带 `overwrite?`，命中同名且 overwrite → **先成功 ingest 新文档、再删旧文档**（安全顺序：中途失败不丢旧数据，代价是覆盖瞬间短暂双份 + 多 ~2 subrequest，可接受）。覆盖模式让 3.7 = 真同步：重拉即刷新。跳过模式 = 预检到库内同名直接不发起请求。

### 4. 批量运行态：组件级，不做任务实体
手动批量几十篇、同步 `await` 循环、秒级~分钟级、**无需刷新后继续** → 落库任务实体（Job 系统）是过度设计。答案 = 弹窗内组件 ref 运行态：行级 `pending/running/成功/跳过/失败(类型)`，循环结束出汇总表，单行重试瞬时失败，`停止` flag 每篇检查。失败**分型**决定重试语义：409/超限 = 确定性失败重试无意义；network/5xx = 瞬时值得重试。

### 5. 把 409 消在循环前：冲突三重预检
- **与库内冲突**：目标 KB 文档列表已在 store，建 `Set(title)` 预检；按策略标"将覆盖"或"已存在跳过"
- **与批量内互斥**：勾选集合里 title 重复（改出的）→ 红标要求改，不靠覆盖
- **跨目录同名**：title 默认带目录前缀（`docs/a/guide` ≠ `docs/b/guide`），天然唯一

### 6. 图 URL 改写规则（入库前完成）
改写发生在浏览器 POST 前，纯前端预处理，**不碰后端、不留数据债**。对 `![alt](url)`（跳过代码围栏内行）：

| url 形态 | 处理 |
|---|---|
| `http(s)://` 绝对 | 原样保留 |
| `/img/a.png` 根相对 | 拼 `{branch}/img/a.png` |
| `./img/x.png` / 相对 | 拼 `{branch}/{文件目录}/img/x.png`，目录段 `../` 先归一化 |
| `../` 归一化逃出仓库根 / `data:` / `//` 协议相对 | **不转** → chunker 照常收 alt，渲染降级纯文字、**不发请求**（复用 M3 白名单安全失败） |
| 路径含空格/中文 | 逐段 `encodeURIComponent`（保留 `/`） |

最终形如 `https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{normalizedPath}`。

---

## 端到端流程

```
rag/[id].vue 文档页「从 GitHub 引入」→ UModal
  ① 填 owner/repo（branch 可空 = 默认分支）→ 目标 kbId = 当前库
  ② GET repos/{o}/{r}/git/trees/{branch}?recursive=1 → 过滤 .md，>500KB 预标
  ③ 勾选清单（行内改名、冲突预检、>100 分批确认）+ 冲突策略（覆盖/跳过）
  ④ 串行循环每篇：fetch raw → 图 URL 改写 → POST /api/rag/documents
     body: { kbId, title, content, sourceType:'github', overwrite? }
  ⑤ 运行态表格实时推进 → 结束汇总「成功 N · 跳过 M · 失败 K」→ 单行重试瞬时失败
  ⑥ loadDocuments() 刷新文档列表（覆盖的旧 docId 被替换，无持久引用副作用）
```

**复用（零改动）**：上传管道（ingest/chunk/embedding/批量写库）、M3 图片白名单渲染、文档管理 UI。**后端只新增 1 个逻辑分支**（overwrite）+ schema 放行 sourceType。

---

## 实现改动范围

| 侧 | 改动 | 说明 |
|---|---|---|
| 后端 | `createDocument` 加 overwrite 分支 | 唯一新逻辑：dup + overwrite → 跳过 409、先新后删 |
| 后端 | `createDocumentSchema` 加 `sourceType?` | zod strip 默认丢，需放行 |
| 后端 | 写入方传新值 | ingest-docs.ts→'local'、手动上传→'manual' |
| 前端 | `GitHubImportModal.vue`（新） | ①②③④⑤⑥ 全流程 |
| 前端 | `app/utils/github.ts`（新） | GitHub API 封装 + `resolveImageUrls()` 改写函数 |
| 契约 | `shared/types/rag.ts` | `UploadDocumentInput` 加 `sourceType?`、`overwrite?` |

**先验证假设（M4-0，第一步做）**：curl 确认 api.github.com trees 与 raw 域对浏览器 CORS 可达；用真实公开仓库试改写。退路 = [09-02 方案](2026-09-02-rag-phase-b-implementation.md) 的本地 CLI。

---

## 里程碑与验收

| 里程碑 | 内容 | 验证 |
|---|---|---|
| M4-0 | 假设验证（CORS/域名/改写） | curl + 真实仓库试跑 |
| M4-1 | 后端：sourceType 通道 + overwrite | curl：同名 overwrite 后内容更新、docId 变、subrequest 可控 |
| M4-2 | 前端：GitHubImportModal + resolveImageUrls | typecheck + 本地全流程 |
| M4-3 | 端到端（建议目标仓库：本项目 qlHuo/holyer-ai） | 六功能验收 |

**验收清单**：真实公开仓库导入 → 清单/超限标注正确、汇总计数准确；二次同库同名 + 覆盖 → 内容为新版、旧向量被级联清（检索不到旧句）；跳过模式不发起请求；对话命中导入文档 → 相对图以绝对 raw URL 渲染、白名单外 URL 降级且网络面板无请求；行内改名生效、≤255 校验、批量内重名红标拦截；运行中停止 → 剩余标未执行；瞬时失败单行重试成功；sourceType 列表区分；空 .md 仓库/错误仓库友好文案。

---

## 关键洞察

- **浏览器编排的隐藏红利**：GitHub 调用完全不经过 Worker，零 CF subrequest；每篇上传是独立 HTTP 请求 = 配额逐次重置。批量因此不需要任何批量端点，一个 for 循环即可。
- **覆盖策略 = 同步能力的钥匙**：没有它，3.7 只是一次性灌入，重拉全 409；有了它，"改一次仓库、重拉一次"才是真同步。安全顺序必须"新成功 → 删旧"，否则中途失败丢原文。
- **sourceType 的教训**：一个为"未来可能有别的格式"预留的字段，在需求定死只做 md 后就该清醒地改造成有信息的通道，而不是任它死着。死字段不如活用途。
- **图改写是可后置的纯前端活**：发生在 POST 前、不碰后端、可随时补——但既然一次做掉成本极低，不做反而给验收留尾巴。

## 相关文档

- [RAG 阶段 B 实施方案](2026-09-02-rag-phase-b-implementation.md) — M4 骨架、浏览器编排/配额论证（本文是其需求定稿）
- [RAG 知识库 UI + 复用清单](2026-09-06-rag-ui-component-reuse.md) — 文档页与上传 Modal 现状
- [RAG 知识库完整设计](2026-08-19-rag-knowledge-base-design.md) — 决策 1/7、3.11 引用溯源
- [知识库图片展示边界](2026-08-26-rag-image-display-boundary.md) — M3 白名单 / 相对 URL 不放行根因
- [实施路线图](../../.claude/plan/roadmap.md) — Phase 3 阶段 B 任务 3.7
