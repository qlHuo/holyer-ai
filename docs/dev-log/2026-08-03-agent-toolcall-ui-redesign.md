# Agent 工具调用指示器设计

## 迭代历程

### V0（原始实现）：`ToolCallCard` 大卡片

内联在消息列表，60-80px/卡片（图标圆圈 + 工具名 + 状态 + 结果预览），多工具堆叠加倍高度。问题：随内置工具增多不可持续。

### V1（失败尝试）：`AgentStatusBar` 顶部横排栏

横排 pill 芯片组，放在聊天页面顶部。问题：
- **位置错误**：脱离回复上下文，用户无法关联"AI 正在为这个回复使用工具"
- **布局错误**：横排是仪表盘思维，不是对话 UI 思维
- 已删除

### V2（当前）：`AgentToolInline` 内联纵向

**设计方向**：作为 AI 回复的一部分，极简克制，像"思考过程"的脚注。

**参考**：ChatGPT "搜索中…" / Claude "Using tool…" / Cursor 终端风

**核心决策**：

| 维度 | 决策 | 原因 |
|------|------|------|
| 位置 | 消息容器内，ChatMessage 列表之后 | 视觉上属于当前回复 |
| 对齐 | `pl-9`（36px），对齐 assistant 气泡起始位 | 与 avatar+bubble 布局一致 |
| 排列 | 纵向，每行 ~22px | 对话场景纵向读，横排不适合多工具 |
| 字号 | 12px | 脚注级别，不争夺注意力 |
| 颜色 | `--ui-text-dimmed` 为主 | 灰色克制，不是 UI 主角 |
| 完成态 | 1.5s 后自动折叠消失 | 中间过程不必持久展示 |
| 错误态 | 3s 后折叠，hover 可查 | 错误信息保留稍久以引起注意 |
| 空态 | `v-if` 隐藏，无 DOM | 无工具时零开销 |
| 详情 | 点击展开（仅 done/error） | 默认折叠，按需查看 |

**文件**：

| 文件 | 状态 |
|------|------|
| `app/components/agent/AgentToolInline.vue` | ✅ 使用中 |
| `app/components/agent/AgentStatusBar.vue` | ❌ 已删除 |
| `app/components/agent/ToolCallCard.vue` | 📦 保留归档 |
| `app/components/chat/ChatPanel.vue` | 消息列表内 `<AgentToolInline>` |

### V3（2026-08-03）：卡片式工具调用指示器

参照 Dify / ChatGPT 风格设计稿，将 V2 极简脚注改为白色圆角卡片。

**设计方向**：工具调用作为 AI 回复的可观测性层，卡片式呈现执行过程。

**核心变更**：

| 维度 | V2（旧） | V3（新） |
|------|----------|----------|
| 形态 | 12px 脚注行 | 白色圆角卡片 + 聚合头 |
| 聚合头 | 无 | 「已使用 N 个工具」可整体折叠 |
| 工具图标 | 仅状态图标（✓ / ✗ / 脉冲点） | 按工具类型区分（搜索/地球/计算器/时钟） |
| 耗时展示 | 无 | ✅ 毫秒级耗时（前端计时） |
| 展开详情 | 仅 result 单栏 | ✅ 输入（args）+ 输出（result）双栏 |
| 成功/失败 | 🐛 success 恒为 undefined | ✅ 后端转发 success 字段 |
| 持久化 | 流结束即清空 | 流结束后保留，切换对话/新消息时清空 |

**关联修复**：

| 文件 | 变更 |
|------|------|
| `server/api/chat/index.post.ts` | tool_end 事件补转发 `success` 字段（此前被丢弃，导致 error 态死代码） |
| `app/stores/chat.store.ts` | `AgentToolCallState` 增加 `startedAt` / `durationMs`；`finishStreaming` 不再清空工具列表；`selectConversation` / `startNewChat` 补充清空 |
| `app/composables/useChat.ts` | TOOL_START 记录时间戳；TOOL_END 计算耗时 + 读取 payload.success |
| `app/components/agent/AgentToolInline.vue` | 完全重写为卡片式布局 |
| `app/components/chat/ChatPanel.vue` | `showToolInline` 移除 `isStreaming` 依赖；`is-streaming` prop 动态化 |
| `docs/dev-log/2026-08-03-agent-toolcall-ui-redesign.md` | 本文件（追加 V3） |
