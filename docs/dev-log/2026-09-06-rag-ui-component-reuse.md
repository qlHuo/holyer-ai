# 2026-09-06 — RAG 知识库 UI 实现 + 公共组件复用清单

> 本次交付：Phase 3 阶段 B 的 3.6「知识库管理 UI」——一级 `/rag` 知识库卡片网格（建/改/删）+ 二级 `/rag/:id` 文档管理（上传/列表/下载/删除），严格镜像提示词管理（prompts）交互模式。
>
> 决策：**本次按独立实现，不复用、不抽取公共组件**（允许与 prompts 出现重复代码）；沉淀本清单记录未来可抽公共件，待 UI 稳定后单独做「公共组件抽取」专项。

---

## 一、本次交付概览

| 层 | 文件 | 说明 |
|---|---|---|
| API | `app/api/rag.ts` | 8 个方法，镜像 `app/api/prompts.ts` + request 自动解包 |
| Store | `app/stores/rag.store.ts` | KB 态 + 文档态（currentKbId 耦合），`kbOptions` 供聊天选库器复用 |
| 页面 | `app/pages/rag/index.vue` | 一级知识库列表（三段式 + 卡片网格） |
| 页面 | `app/pages/rag/[id].vue` | 二级文档管理（三段式 + 行列表 + 上传/删除弹窗） |
| 组件 | `app/components/rag/RagKbCard.vue` | 知识库卡片 |
| 组件 | `app/components/rag/RagKbFormModal.vue` | 建库/改库（UForm+Zod） |
| 组件 | `app/components/rag/RagKbDeleteModal.vue` | 删库确认（级联提示） |
| 组件 | `app/components/rag/RagUploadDocumentModal.vue` | 选 .md → File.text() → 上传（title 默认文件名，防同名 409） |
| 组件 | `app/components/rag/RagDocumentRow.vue` | 文档行（下载/删除 hover 操作） |
| 组件 | `app/components/rag/RagDocumentDeleteModal.vue` | 删文档确认 |
| 修改 | `app/components/layout/LayoutSidebar.vue` | 加「知识库管理」入口（i-lucide-database） |

**本次明确不做**：文档在线编辑（markdown 编辑器，复杂）— 已记录到 status/roadmap，后续单独实现；聊天页选库器 — 后续单独做（store 的 `kbOptions` 已预留）。→ 已于 2026-09-08 定稿方案，见 [聊天知识库选择器](2026-09-08-chat-knowledge-base-selector.md)。

## 二、候选公共组件清单（未来抽取，本次不抽）

> 触发点：做完本页后，prompts 与 rag 两套 UI 出现成对重复。抽公共组件前先定设计（slot 化 / props），避免接口过度设计。建议至少等一个「第三处使用」出现或进入一次 UI 重构时再抽。

| 候选公共件 | 本次 RAG 实现 | 既有同类（prompts/其他） | 差异点与抽取建议 |
|---|---|---|---|
| **三段式状态区**（loading 骨架/error 重试/empty 空态，v-if 四态样板） | rag 两个页面 | `prompts/index.vue` L62-144、`LayoutSidebar` 对话区 | 可抽 `<StateArea>`：props `loading/error/empty` + 默认 slot 放内容；error 文案 + 重试回调；empty 自定义 icon/文案/主行动 slot。四态样板每页约 60 行，抽后每页留 ~10 行 |
| **卡片网格容器 + 骨架屏** | `/rag` KbCard 网格 | `PromptsCard` 网格（prompts/index L64-82 / L132-143） | 网格 class 串两处一致（`grid ... lg:grid-cols-2 2xl:grid-cols-4` + 响应式隐藏骨架），可抽 `CardGrid`（默认 slot 卡片、loading 时渲染骨架） |
| **删除确认 Modal** | RagKbDeleteModal / RagDocumentDeleteModal | PromptsDeleteModal、LayoutSidebar 内联删除 UModal | 结构 100% 同构：标题 + 图标 + 「确认删除 X」 + 危险提示 + 取消/删除。可抽 `<ConfirmModal>`：props `open/title/message/dangerText(可选)/loading`，内置删除逻辑回调 |
| **表单 Modal 基座** | RagKbFormModal / RagUploadDocumentModal | PromptsFormModal | 共同骨架：`UModal open bridge + #body(UForm+Zod) + #footer(取消 + formRef.submit + saving loading)`。可抽 `FormModal` 壳 + 暴露 `formRef/submit`，或做 composable `useFormModal(open)` 统一 open-bridge + 重置逻辑 |
| **卡片 hover 操作（pencil/trash）** | RagKbCard 头部 | PromptsCard 头部 | 同构按钮组 + `md:opacity-0 md:group-hover:opacity-100` 显隐。可并入 Card 组件的操作区 slot，或抽 `CardActions` |
| **空态图标块** | rag 两页空态 | prompts 空态 | icon `opacity-25` + 文案 + outline 主行动按钮，形态一致。建议并入 StateArea |
| **时间格式化** | RagKbCard / RagDocumentRow 各一份 `formatDate`（`toLocaleDateString`） | PromptsCard.formatDate、LayoutSidebar.formatTime（相对时间） | 项目尚无公共 date util。**最值得先抽**：`app/utils/date.ts` 提供 `formatDate` + `formatRelativeTime`，统一三处（当前不统一：卡片绝对日期、侧边栏相对时间） |
| **文件 Blob 下载** | `rag.store.downloadDocument`（store 内联 Blob + a.click） | （无既有） | 新能力，通用性高（未来导出/下载其他资源可用）。抽 `app/utils/download.ts`：`downloadTextFile(filename, content, mime)` |

## 三、记录：本次碰到的设计决策（实现备忘）

1. **两级页而非双栏**（用户选定）：一级完全复刻 prompts 网格（一致性优先）；二级文档用**行式列表**而非卡片——文档是「标题+元信息+操作」结构，行式扫描效率高，与侧边栏对话列表同风格。
2. **上传不走 multipart**：后端收 `{kbId,title,content}` JSON；前端 `File.text()` 读入再 POST。title 默认 = 文件名去 `.md`，允许改（服务端同名同库 409，改名即绕过，无需自动去重）。
3. **前端预检 content ≤ 500KB**：对齐 `server/api/rag/schema.ts` 上限，超限先拦（上传大文档进服务端再抛会白等一次 embedding）。
4. **建库/改库返回的 `docCount` 恒为 0**（service 已知不对称）：`updateKB` 用 `{...detail, docCount: item.docCount}` 保留原计数，UI 不闪 0。
5. **上传成功本地 unshift**、删除本地 filter、返回列表只信任 list 接口 —— 沿用 prompt.store 的乐观更新风格。
6. **侧边栏高亮**：prompts 用 `route.path === '/prompts'`（无子路由）；rag 有二级页，用 `route.path.startsWith('/rag')` 使两级都高亮。

## 四、视觉改造：冷蓝 + 琥珀点缀（2026-09-07）

针对「太素 / 交互原始」，在 rag 组件内做一轮**克制上色 + 交互修正**（用户定调：不炫丽但要有颜色区分）。形成可同步到 prompts 的颜色语言：

- **身份识别 = 首字母方块 + 6 色固定板**（`app/utils/kbAvatar.ts`，09-07 定稿）：取库名首字（英文首字母），颜色由**创建时间哈希**命中 6 组 Tailwind palette（sky/indigo/violet/teal/rose/amber，亮暗双模）——同库跨刷新稳定。卡片与二级页头共用同一 identity；一级页标题仍用 `i-lucide-database` 表示"库列表"
- **暖点缀（amber = 文档/内容）**：.md 图标容器 `bg-amber-500/10 text-amber-600 dark:text-amber-400`（w-8 h-8 rounded-md）——「冷库暖文档」，呼应 ADR-011 冷色暖质
- **数字强调**：卡片计数块改 `bg-primary/10` + `text-primary`（数字 `text-sm font-semibold`）；文档行切片数 `text-primary font-medium`
- **hover 反馈规范**（09-07 定稿，已记入 `.claude/rules/frontend.md`）：hover 只用 border / box-shadow / 背景色，**禁用 transform 位移**；卡片用 `hover:border-primary hover:shadow-sm`
- **操作常显化**：删掉 `opacity-0 group-hover:opacity-100`，按钮改常显 ghost（触屏/首次可见性；此前移动端功能完全不可见）
- **页头补语境**：一级页加「知识库 + N 个」标题计数；二级页「返回 + 身份块 + 库名」
- **列表分隔**：文档容器 `divide-y divide-default`
- **上传弹窗状态色**：未选 = 虚线 `border-default hover:border-primary/40` + 灰 icon；选中 = `border-primary/50 bg-primary/5` + 主色 `i-lucide-file-check-2` 就绪态

> 样式是否随主题变量（primary）而非硬编码：身份块全部用 `bg-primary/10 text-primary`，跟随 app.config 的 primary 切换；amber 仅作文档暖点缀（Tailwind 默认 palette）。
>
> **待同步**：prompts 管理页存在同样问题（孤按钮页头 / hover-only 操作 / 无身份色 / 无计数）。样式稳定后随「公共组件抽取」一起回补，避免两处再各写一遍。

## 相关文档

- [RAG 阶段 B 实施方案](2026-09-02-rag-phase-b-implementation.md) — M2 知识库 UI 蓝图（本次实现其管理页部分）
- [RAG 知识库完整设计](2026-08-19-rag-knowledge-base-design.md)
- [实施路线图](../../.claude/plan/roadmap.md) — 3.6 知识库 UI
