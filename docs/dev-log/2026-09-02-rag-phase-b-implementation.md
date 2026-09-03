# 2026-09-02 — RAG 知识库阶段 B 产品化：实施方案

> 核心洞察：阶段 B 不是"新造一个知识库功能"，而是给阶段 A 已验证的 service 补上 HTTP / UI 两个入口，外加一次图片渲染的**安全收窄**。难度不在检索，而在三处横切：**CF subrequest 配额**（决定 API 必须批量写库）、**图片白名单全链路当前是断的**（G2→G3→G4 一条线）、**多文档重复上传语义**（无唯一约束）。

---

## 讨论背景

[阶段 A 落地](2026-08-31-rag-stage-a-implementation.md)已于 2026-08-31 完成：语义分块 + qwen3.7 embedding + pgvector + `search_knowledge_base` 工具注册，12 问召回 92%，[上线 Neon](2026-08-31-neon-rag-deployment.md)。

[roadmap](../roadmap.md) 阶段 B 待办 3.5–3.8：上传 API、知识库 UI、GitHub 引入、图片展示 + 白名单渲染。

**2026-09-02 补三个方向决定**：
1. **聊天页做简单的知识库选择器**（检索范围限定到所选库；不传 = 全库）
2. **GitHub 引入走"浏览器编排"路线**（前端直连 GitHub API 抓清单 → 逐条复用上传 API），规避 CF 配额
3. 本文档即阶段 B 实施方案

---

## 结论速览

### 现状资产 vs 缺口（阶段 A 交付 → 阶段 B 继承）

| 层 | 现状 | 是否可直接用 |
|---|---|---|
| Schema 三表（含 `images`/`embedding_model` 预留列、FK 级联） | [schema.ts](../../server/db/schema.ts) | ✅ |
| chunker：图片 alt→content、url→`Chunk.images` | [chunker.ts](../../server/service/rag/chunker.ts) | ✅ 产出已含 images |
| embeddings / retriever | [embeddings.ts](../../server/service/rag/embeddings.ts) · [retriever.ts](../../server/service/rag/retriever.ts) | ✅ |
| `search_knowledge_base` 工具（已注册） | [knowledge-base-search.ts](../../server/service/agent/tools/builtin/knowledge-base-search.ts) | ✅ |
| **灌库核心逻辑** | 仍埋在 [ingest-docs.ts](../../scripts/ingest-docs.ts) 脚本里（含 Neon/Docker 双驱动分支） | ❌ G1：未抽 service，API 无法复用 |
| **images 落库** | chunker 产出了，但 ingest 脚本插入 chunks 时**没写 images 列** | ❌ G2：DB 里全为 NULL |
| **检索带出 images** | `SearchResult` 无 images，SELECT 没查 `c.images` | ❌ G3 |
| **图片渲染白名单** | [markdown.ts](../../app/utils/markdown.ts) image 规则只加 `loading="lazy"`，无 URL 约束 | ❌ G4：**既有的 prompt injection 外链缺口** |

> G2→G3→G4 是一条线：3.8 要从"分块写入 → 检索带出 → LLM 看到 → 前端放行"逐段打通，不能只在渲染层加个判断。

### 关键实施顺序（较 roadmap 调整两处）

```
M0  前置重构 + 安全收窄          （G1 抽 service + G2 images 落库 + G4 渲染白名单）
M1  3.5 上传 API + KB CRUD API    （依赖 M0）
M2  3.6 知识库 UI + 聊天选库器     （依赖 M1）
M3  3.8 检索带图 → 端到端放行      （G3 + LLM 引用链路，依赖 M0/M1）
M4  3.7 GitHub 文档引入            （浏览器编排，复用 M1 上传 API，最后做）
```

两处调整的理由：
- **安全收窄（G4）前置到上传 API 之前**：3.5 一上线用户能传任意 `.md`，注入源就位；先堵住图片外链口子再开放上传（详见[图片边界文档](2026-08-26-rag-image-display-boundary.md)第七节）。
- **3.7 放最后**：它依赖上传管道 + 知识库 UI + 白名单三者齐备才有意义，且属可选价值（自己 clone 也能拖文件），优先级最低。

### 两条贯穿全程的铁律

1. **一切进 API 的写库必须批量**：`neon-http` 每次查询 = 1 个 CF subrequest，免费配额 50/请求（见 [subrequest 超限](2026-09-01-cf-workers-subrequest-limit.md)）。阶段 A 脚本能逐 chunk insert 是因为跑在本机；搬进 API 必须 `db.insert().values(rows[])` 多行插入 + embedding 按批调用。
2. **跨脚本 / API / 运行时的核心 service 保持"零 Nitro 依赖、凭据参数注入"**（沿用 [embeddings.ts](../../server/service/rag/embeddings.ts) 的模式），否则脚本（`process.env`）与运行时（`useRuntimeConfig`）无法复用同一份逻辑。

---

## M0 前置重构 + 安全收窄

### M0.1 抽取 ingest service（G1）+ images 落库（G2）

**产出**：`server/service/rag/ingest.ts`，把 [ingest-docs.ts](../../scripts/ingest-docs.ts#L90-L130) 的 5a–5d 逻辑收进一个函数：

```ts
export interface IngestDocumentInput {
  kbId: string
  title: string
  content: string          // 原始 markdown
  sourceType?: string      // 默认 'markdown'，GitHub 引入可填 'github'
}
export interface IngestResult { docId: string, chunkCount: number }

// db + config 由调用方传入（脚本传自建连接 + .env；API 传 ~~/server/db + runtimeConfig）
export async function ingestDocument(
  db: DbClient,
  config: EmbeddingConfig,
  input: IngestDocumentInput
): Promise<IngestResult>
```

行为（对齐脚本 + 补三件事）：
1. INSERT documents 行（title/content/sourceType）
2. `parseMarkdown` + `chunkSections` + 标题路径前缀拼进 content（与脚本 [L100-107](../../scripts/ingest-docs.ts#L100-L107) 一致）
3. embedding 每批 `BATCH_SIZE = 20` 调用 `embedTexts`
4. **一次多行 INSERT 全部 chunks**（含 `images`、`embeddingModel`）→ 满足配额铁律 ①，同时补上 G2
5. 中途失败 → `DELETE document by id` 回滚半成品（不留孤儿向量）

脚本 [ingest-docs.ts](../../scripts/ingest-docs.ts) 改造为逐文件调用 `ingestDocument`，保留双驱动分支与进度打印，**继续作为批量导入调试工具**。

> G2 补齐的落地细节：chunks 表 `images` 列已有 schema，ingest 时把 chunker 产出的 `ChunkImage[]` 原样写入即可，零迁移。

### M0.2 渲染层白名单（G4）— 先堵既有的外链缺口

目标行为：markdown 图片只有**显式放行**的 URL 才出图，其余降级为文字、**不发请求**。放行集合由渲染时的 `env.allowedImages` 决定，缺省为空集 → 普通聊天（未触发知识库检索）一张图都渲染不出来。

改动点（三层）：
1. **[markdown.ts](../../app/utils/markdown.ts) image 规则**（现 L94-100）：读 `env?.allowedImages`；`src` 不在集合内（或非绝对 http(s) URL）→ 返回降级占位（`<span class="text-muted">[图片]</span>`，alt 非空则显示 alt）；放行的保留 `loading="lazy"`。
2. **[MarkdownContent.vue](../../app/components/chat/MarkdownContent.vue) 的 render 调用**（现 L21-25）：`md.render(processed)` → `md.render(processed, { allowedImages })`，`allowedImages` 由新 prop 传入（`MarkdownContent` 目前只有 `content`/`isStreaming` 两个 prop，需加一个）。
3. **调用方传入集合**：见 M3（检索轮内 tool 结果里的图片 URL）。M0 阶段先实现规则 + prop + 默认空集（此时所有消息图片都降级，属预期——收窄行为先落地，能力后启用）。

**验收**：普通聊天里 LLM 输出 `![](http://任意/x.png)` → 前端渲染为文字占位，网络面板无该请求。

---

## M1 3.5 上传 API + 知识库 CRUD

### 前端契约类型（共享）

`shared/types/rag.ts`（新增）：
- `KnowledgeBase { id, name, description, createdAt, docCount }`
- `DocumentSummary { id, kbId, title, sourceType, createdAt, chunkCount }`
- `UploadResult { document: DocumentSummary, chunkCount }`

### 路由面（全部新增，遵循 [api-conventions](../../.claude/rules/api-conventions.md)）

| 方法 | 路由 | 说明 |
|---|---|---|
| GET | `/api/rag/knowledge-bases` | KB 列表（联表 docCount，聊天选库器 + 管理页共用） |
| POST | `/api/rag/knowledge-bases` | 建库（name 1..100 / description ≤500） |
| DELETE | `/api/rag/knowledge-bases/:id` | 删库（FK 级联删 doc+chunk，单 SQL） |
| GET | `/api/rag/documents?kbId=` | 文档列表（`count(*)` 聚合带 chunkCount） |
| POST | `/api/rag/documents` | **3.5 主交付**：`{ kbId, title, content }` → ingest service → 返回 chunkCount |
| GET | `/api/rag/documents/:id` | 文档详情（含原文 content，下载用） |
| DELETE | `/api/rag/documents/:id` | 删文档（级联删向量） |

### 关键设计决策

1. **不用 multipart**：markdown 是纯文本，请求体直接收 `{ kbId, title, content }` JSON。前端 `File.text()` 读完再 POST，完全避开 Edge 文件处理限制（与"不引 R2、原文存 DB"一致）。
2. **上传 + 建库一体**：上传依赖 KB 存在，3.5 必须连带 KB CRUD，无法独立交付。
3. **Zod 校验**：`server/api/rag/.../schema.ts` 独立文件；content 加长度上限（如 ≤ 500KB，防单请求超时/内存），title ≤255。
4. **Service 归属**：KB/文档 CRUD 只在运行时 API 用 → 放 `server/service/rag/knowledge-bases.ts` / `documents.ts`，直接 `import { db }`（与 [conversation service](../../server/service/conversation/mutations.ts) 同风格）；**ingest 核心保持 db+config 参数注入**（M0.1），供脚本/API/GitHub 三方复用。路由只调 service、不碰 db。
5. **重复上传语义**：DB 无唯一约束 → 同名重复上传会重复入库（向量翻倍）。个人场景**不做自动去重**，UI 给出温和提示即可；若要严格，可在 service 加 `title + kbId` 存在性检查返回 409，见"开放问题"。

### 验收
- `curl` 上传一篇含代码的 .md → 返回 chunkCount；`search_knowledge_base` 检索到新内容
- 重复上传 → 无崩溃、语义清晰提示
- 单篇 ~50 chunk 的上传全程 subrequest 数 ≪ 50（M0 批量写保证）

---

## M2 3.6 知识库 UI + 聊天选库器

### 管理页

- **页面**：`app/pages/rag/index.vue`；侧边栏 LayoutSidebar「提示词管理」下方加一项「知识库」（icon `i-lucide-database`），路径高亮同 prompts。**onMounted 清空 `chatStore.currentConvId`**（防对话状态串扰，同 prompts 页做法）。
- **Store**：`app/stores/rag.store.ts`（Setup Store，镜像 [prompt.store.ts](../../app/stores/prompt.store.ts)）：`kbList / currentKbId / documents / loading / loadError` + `loadKBs / createKB / removeKB / loadDocuments / uploadDocument / removeDocument / downloadDocument`，导出 `kbOptions`（computed，供所有选择器用）。
- **API 封装**：`app/api/rag.ts`（镜像 [prompts.ts](../../app/api/prompts.ts)）。
- **组件**（镜像 [prompts/index.vue](../../app/pages/prompts/index.vue) 的 骨架屏/加载失败重试/空态 三段式）：
  - KB 列表区 + `RagCreateKBModal`（UForm + Zod）
  - 选中 KB 后文档列表（title/chunkCount/sourceType/时间），行内下载/删除
  - 上传入口：UButton 触发 `<input type="file" accept=".md,text/markdown">` → `File.text()` → `uploadDocument`，成功 toast "切成 N 块"；文件名默认 title
  - 删除确认 Modal，文案明确"级联删除文档的所有向量切片"

### 聊天选库器（简单版）

镜像 [ChatModelSelector.vue](../../app/components/chat/ChatModelSelector.vue)，**不做 DB 持久化列**（与当前 model 的选择语义一致：客户端选中态随请求发送）：

1. `app/components/chat/KnowledgeBaseSelector.vue`：USelect，items = rag.store 的 `kbOptions` + 首项「全部知识库」(value `null`)，绑定 `chatStore.selectedKbId`
2. 放进 [ChatInput.vue](../../app/components/chat/ChatInput.vue#L139-L145) 工具栏 ChatModelSelector 旁
3. `chat.store` 加 `selectedKbId: ref<string | null>(null)`
4. 请求链路：`useChat.sendMessage` 与 `regenerate` 的 body 加 `kbId: chatStore.selectedKbId` → `ChatBodySchema` 加 `kbId: z.string().uuid().nullish()`

### 默认 kbId 注入 Agent 执行层（选库器落地的关键接线）

工具 `search_knowledge_base` 的 `kbId` 是 LLM 提供的参数，但 LLM 无从得知"当前选了什么库"。方案：**服务端在 runner 注入默认值**，接线点已核实——

1. `AgentRunConfig`（[agent/types.ts](../../server/service/agent/types.ts#L59-L64)）加 `defaultKbId?: string`
2. [/api/chat](../../server/api/chat/index.post.ts#L154-L156) 调用 `runAgentLoop` 时传 `{ ...config, defaultKbId: body.kbId }`（现有调用未传 config，用默认值）
3. [runner.ts](../../server/service/agent/runner.ts#L357-L374) 工具执行前：当 `tc.name === 'search_knowledge_base' && !args.kbId && config.defaultKbId` 时，`args.kbId = config.defaultKbId`

效果：选了 KB A → 该轮检索默认限定 A；不选 → 不注入，LLM 传不传 kbId 都查全库。

### 验收
- 建两个库、各传不同文档 → 选库器切到库 A，问库 A 专属内容能命中；切「全部」两者都能搜到
- 删除文档/库 → 列表即时消失，向量级联清理，再检索无残留

---

## M3 3.8 图片端到端（G3 + LLM 引用 + 白名单放行）

在 M0（规则 + env 已就位）基础上补检索侧缺口，让"命中 → 带图 → 放行"成立。

| 环节 | 改动点 |
|---|---|
| G3a 检索带出 images | [retriever.ts](../../server/service/rag/retriever.ts)：SELECT 加 `c.images::text`，`SearchResult` 加 `images: ChunkImage[]`（`:text` 后 JS `JSON.parse`，规避双驱动 jsonb 返回形状差异） |
| G3b 工具返回图片 markdown | [knowledge-base-search.ts](../../server/service/agent/tools/builtin/knowledge-base-search.ts) execute：每条命中片段末尾追加该 chunk 的图片 markdown 行（`\n\n![alt](url)`）→ 结果既进 memory 给 LLM 看，也经 `TOOL_END` 落库 + 推前端（[chat 端点 L196-208](../../server/api/chat/index.post.ts#L196-L208)） |
| 放行白名单 | 前端从"同轮 tool 消息"的结果文本里正则提取图片 URL 建 Set，作为 `allowedImages` 传给 MarkdownContent |

### 白名单来源：选「从 tool 结果解析」（方案 A）

对比结论（详见分析）：工具结果**已持久化在 messages 表**（assistant(tool_calls) → tool → assistant(text) 三段，见 [chat.store persistAgentToolCalls](../../app/stores/chat.store.ts#L254-L281)），因此：
- **历史回放安全**：刷新/切对话后白名单由持久化的 tool 消息重建，不丢
- **不动 SSE 协议**：`TOOL_END` 已携带 `result`，无需新事件
- 替代方案（新 SSE 通道 / 前端在 assistant 下方直接渲染 tool 图）要么改协议、要么偏离决策 7，均否决

实现落点：渲染某条 assistant 消息时，其 `allowedImages =` 同轮（最后一条 user 消息之后）各 `tool` 消息内容中 `!\[...\]\((https?://[^)\s]+)\)` 提取的 URL 并集。具体在 `MessageBody`/渲染组件读 store 拿到同轮 tool 消息后，转为 prop 注入 MarkdownContent（M0.2 加的 prop）。

### 一条安全硬约束（相对 URL 不得放行）

chunker 只存 `ChunkImage { url, alt }`，本地文档的 `![架构](img/a.png)` 是相对 URL。若让它出图，浏览器会请求**当前应用源**下的 `/img/a.png` → 404 或潜在同源滥用。因此：**G3b 只把绝对 `http(s)` URL 转成图片 markdown**；相对 URL 丢弃、仅保留 alt 文本。白名单校验同样只认绝对 URL。

### 固有脆弱点（接受，不放松）

LLM 复述图片 markdown 时若改写 URL / 丢 alt → 该图降级为文字（不在白名单即拒）。这是**宁可漏图不可放行**的安全失败，降级文案友好即可。

### 验收
- 上传一篇含远程图（如 GitHub raw）的 .md → 对话命中该节，回答里图片按白名单渲染
- 文档里藏 `![](http://attacker/beacon.png)` 注入 → 该 URL 不在检索结果 → 渲染降级，网络面板无请求
- 刷新/重开对话 → 历史答案图片仍能按回放白名单渲染

---

## M4 3.7 GitHub 文档引入（浏览器编排）

### 为什么不是"服务端拉取"

一个端点循环抓 N 个文件 = N 次 subrequest，58 篇量级直接打爆 50 配额（还没算 embedding + 写库）。**浏览器编排**把每次上传拆成独立 HTTP 请求（配额按请求重置），天然规避：

```
UI 填 owner/repo
  → 前端 fetch GitHub trees API（CORS 开放，浏览器直连）
  → 过滤 .md、展示勾选清单（显示标题/大小）
  → 逐条：fetch raw URL（raw.githubusercontent.com，CORS *）
        → 图片相对路径改写为绝对 raw URL
        → POST /api/rag/documents（复用 M1 上传 API）
```

### 相对图片路径改写（roadmap 的 404 卡点）

下载到 content 后、POST 前，把 `![alt](./img/x.png)` 一类的相对 URL 重写为 `https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{contentDir}/img/x.png`（branch 需先从 trees API 的 HEAD 解析；contentDir 取该文件所在目录）。改写发生在入库前 → chunker 存进 `images` 的就是绝对 URL，M3 白名单即可放行。

### 需求拆解

| 需求 | 做法 |
|---|---|
| 输入 | owner / repo（+ 可选 branch、path 前缀过滤） |
| 文件清单 | `GET /api.github.com/repos/{o}/{r}/git/trees/{branch}?recursive=1` 过滤 `.md` |
| 勾选 + 逐个上传 | 前端循环，每文件独立请求（含超时/重试/进度） |
| title | 文件名（去 `.md`），带目录前缀（对齐脚本 titlePrefix 思路，便于溯源） |
| 安全 | 只请求 github.com / raw.githubusercontent.com 固定域；输入长度/格式校验（服务端上传 API 已是白名单域的上游，无新增 SSRF 面） |

**待验证假设**（实现第一步就 curl 确认）：GitHub trees API 与 raw 域名对浏览器 CORS 的可达性。若生产环境网络无法直连 GitHub，退路是把 M4 降级为本地 CLI 脚本（复用 ingest service，如 [ingest-docs.ts](../../scripts/ingest-docs.ts) 模式），产品 UI 保持"手动拖文件"。

### 验收
- 填一个含 .md + 相对路径图片的真实 repo → 清单正确、勾选后逐条入库
- 对话命中导入文档 → 图能渲染（绝对 raw URL 在白名单内）
- 一个不含 .md 的 repo → 空清单 + 友好提示

---

## 里程碑与风险

| 里程碑 | 验证方式 |
|---|---|
| M0 | typecheck + 普通聊天图片外链降级（网络面板无请求）；脚本重灌仍 92% |
| M1 | curl 上传/建库/删除全链路；单篇 ~50 chunk subrequest ≪ 50 |
| M2 | 页面建库/上传/下载/删除 + 选库器限定检索范围 |
| M3 | 图片端到端渲染 + 注入 URL 拒绝 |
| M4 | 真实 repo 引入 + 图片 404 无复现 |

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 上传 API 写库打爆 subrequest | 中 | 高 | M0.1 强制多行 insert + 批 embedding；单篇文档本身 chunk 量小 |
| GitHub CORS/网络不可达 | 中 | 中 | M4 第一步验证；退路 = 本地 CLI + 手动拖文件 |
| LLM 不按白名单复述图片 URL | 低 | 低 | 降级为文字，安全失败可接受 |
| 重复上传向量膨胀 | 中 | 低 | 不做自动去重；文档管理页可手动删，观察后决定是否加 409 |

## 开放问题（实现时定，不阻塞 M0-M2）

1. **重复上传语义**：服务端 409（title+kbId 存在即拒）还是仅 UI 提示？（倾向仅提示）
2. **选库器的会话级归属**：本文档按"简单版"（随请求发送，不落库，同 model 语义）；若发现"切对话想回到各自库"是刚需，再加 `conversations.kb_id` 列（此时需 drizzle-kit 迁移 + selectConversation 载入 + 端点 update）。

## 相关文档

- [RAG 知识库完整设计](2026-08-19-rag-knowledge-base-design.md) — 决策 1/7、Schema、扩展性
- [图片展示边界](2026-08-26-rag-image-display-boundary.md) — 决策 7 论证与三层边界
- [阶段 A 落地](2026-08-31-rag-stage-a-implementation.md) · [上线部署](2026-08-31-neon-rag-deployment.md) · [subrequest 超限](2026-09-01-cf-workers-subrequest-limit.md)
- [实施路线图](../../.claude/plan/roadmap.md) — Phase 3 阶段 B 任务 3.5–3.8
