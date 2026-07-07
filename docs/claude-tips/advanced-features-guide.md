# Claude Code 进阶功能实战指南

> 不讲概念，讲场景——什么情况下用哪个功能，具体怎么操作。概念解释见 [commands-vs-skills](commands-vs-skills.md)。

---

## 全景速览

从"纯对话"到"高效协作"，Claude Code 提供了 7 类进阶机制：

| 机制 | 一句话 | 谁触发 | 存在哪里 |
|------|--------|--------|---------|
| **Rules** | 操作特定文件时自动注入的上下文 | 自动（按路径匹配） | `.claude/rules/*.md` |
| **Commands** | 你输入 `/xxx` 触发的快捷方式 | 你手动 | `.claude/commands/*.md` |
| **Skills** | 你手动触发 **或** Agent 自动判断调用的能力包 | 你 + Agent | `.claude/skills/*/SKILL.md` |
| **Subagents** | 派"分身"去执行独立任务，不污染主对话 | 你指令 / Agent 自动 | `.claude/agents/*.md`（可选） |
| **Hooks** | 特定事件发生时自动跑脚本 | 自动（事件驱动） | `.claude/settings.json` |
| **Memory** | 跨会话持久化记忆 | 自动 + 你指令 | `~/.claude/projects/.../memory/` |
| **Plan Mode** | 先设计方案、你审批、再动手 | 你指令 / Agent 自动 | 会话内，可存到 `.claude/plan/` |

---

## 1. Rules：让你不用重复提醒 Claude

### 场景

你每次让 Claude 改 `server/api/chat/` 下的文件，都得提醒"记得加 SSE 心跳"——Rules 就是把这个提醒**自动化**。

### 用法

在 `.claude/rules/` 下创建 markdown 文件，frontmatter 中写 `paths` 指定作用范围：

```yaml
---
paths:
  - "server/api/chat/**"
  - "server/utils/sse.ts"
---

# SSE 流式响应规则

每个 SSE 端点必须包含 30 秒心跳：
const heartbeat = setInterval(() => {
  controller.enqueue('event: ping\ndata: {}\n\n')
}, 30000)
```

**效果**：当你让 Claude 编辑 `server/api/chat/xxx.ts` 时，这份规则自动注入上下文，Claude 自动遵守心跳规范——你不用每次重复。

### 本项目已有的 Rules

| 文件 | 作用路径 | 保证什么 |
|------|---------|---------|
| [frontend.md](../../.claude/rules/frontend.md) | `app/**` | Nuxt UI v4 组件用法、Pinia Setup Store 语法、Tailwind v4 CSS 配置 |
| [edge-runtime.md](../../.claude/rules/edge-runtime.md) | `server/**` | 不用 `fs`/`child_process`/`net`，新依赖兼容 Edge |
| [database.md](../../.claude/rules/database.md) | `server/db/**` | 从 `server/db/index.ts` 导入 db，用 `neon-http` 驱动 |
| [sse.md](../../.claude/rules/sse.md) | `server/api/chat/**` | 30s 心跳、响应头格式、部署后关压缩 |

### 什么时候加新 Rule

- 你在对话中**重复提醒了 Claude 某件事 ≥2 次** → 写成 Rule
- 某个技术域的约束**不是全局的**，只影响特定目录 → 用 path-scoped Rule（全局的放 CLAUDE.md）
- 新成员加入项目需要知道的"雷区" → 写成 Rule

### 实际效果对比

```
❌ 没有 Rule：
  你："帮我给 chat API 加个 stop 端点"
  Claude：写了，但没加心跳
  你："加上心跳"
  Claude：加了
  你：（每次都重复）

✅ 有 Rule：
  你："帮我给 chat API 加个 stop 端点"
  Claude：（自动加载 sse.md，直接带上心跳）
```

---

## 2. Commands vs Skills：什么时候用哪个

已有详细对比 → [commands-vs-skills](commands-vs-skills.md)。这里只讲**决策逻辑**：

```
你要做的事情
  ├── 固定流程，每次步骤一样？
  │   └── → Command（.claude/commands/xxx.md）
  │       例：/review（审查当前 diff）、/deploy（构建+部署）
  │
  ├── 需要 Agent 自己判断"什么时候该用"？
  │   └── → Skill（.claude/skills/xxx/SKILL.md）
  │       例：doc-consolidate（Agent 在技术讨论后自动提议归档）
  │
  └── 只是一个快捷提示？
      └── → Command（更轻量）
```

### Command 最简示例

创建 `.claude/commands/review.md`：

```markdown
审查当前 git diff，重点检查：
1. SSE 端点是否有 30s 心跳
2. 是否引入 Node.js 专属 API
3. 数据库查询是否从 server/db/index.ts 导入
4. 新依赖是否兼容 Edge Runtime
```

然后输入 `/review` 就能触发。比每次手打一大段 prompt 快得多。

### Skill 的最简示例

创建 `.claude/skills/my-skill/SKILL.md`（注意必须是目录 + `SKILL.md`，flat file 不会被识别）：

```yaml
---
name: my-skill
description: [做什么]。当用户说"关键词1""关键词2"时触发。
allowed-tools: [Read, Write, Glob, Grep]
---
具体执行逻辑写在这里。
```

Agent 会在匹配"关键词"时**自动提议使用**这个 skill。

---

## 3. Subagents：派分身干活

### 场景

你说"找出项目里所有没有心跳的 SSE 端点"——如果让 Claude 自己找，它要逐个读十几个文件，上下文很快就满了。用子代理（Explore 类型），它独立搜索、只返回结论，主对话干净清爽。

### 什么时候用

| 场景 | 代理类型 | 示例指令 |
|------|---------|---------|
| 广撒网搜索（只读） | Explore | "找出所有直接操作 DOM 的组件" |
| 代码库探索研究 | Explore / general-purpose | "分析 server/service/ 的分层结构" |
| 方案设计 | Plan | "设计 Phase 2 的 Agent 工具调用架构" |
| 查 Claude Code 文档 | claude-code-guide | "Claude Code 的 hooks 有哪些事件" |

### 实际操作

**方式 1**：在对话里直接说
> "用 Explore 代理找出项目里所有没心跳的 SSE 端点"

Claude 会自动 spawning 一个 Explore 子代理去并行搜索。你会在界面上看到子代理的运行状态。

**方式 2**：并行派多个（说"同时"）
> "同时分析 app/、server/、shared/ 三个目录的代码质量"

Claude 会同时启动多个子代理，各自独立工作。本项目的实际案例：Explore × 2 并行扫描 useChat 引用（43s）和 SSE 文件（83s），总耗时 83s 而不是 126s。

### 自定义子代理

如果经常需要执行某类审查任务，创建一个自定义代理比每次都描述要求更高效。

在 `.claude/agents/` 下创建 markdown 文件：

```markdown
---
name: edge-reviewer
description: 审查代码的 Edge Runtime 兼容性和项目规范
tools: [Read, Glob, Grep]
---

你是项目的代码审查员。审查时重点检查：
1. 是否使用了 fs、child_process、net 等 Node.js API
2. SSE 端点是否包含 30s 心跳
3. 数据库查询是否从 server/db/index.ts 导入
4. 新依赖是否兼容 Edge Runtime
5. 响应头是否设置了正确的 Content-Type 和 Cache-Control
```

然后说一句 "用 edge-reviewer 审查上次提交" 就行。

### 和 Rules 的配合

- **Rules**：被动生效，你不需要主动调用——改了 `server/api/chat/` 下的文件，sse rule 自动注入
- **Custom Agent**：主动调用——你想专门审查一次时，派 edge-reviewer 代理

两者互补，不是替代关系。

---

## 4. Hooks：事件驱动的自动化

已有详细指南 → [hooks-guide](hooks-guide.md)。这里补充两个**你的项目可以直接加的实战 Hook**。

### 你已有的：PreToolUse 危险命令拦截

[settings.json](../../.claude/settings.json) 里配置了 `pre-bash-guard.sh`，每次 Bash 命令执行前检查危险模式（`rm -rf /`、`git push --force`、`curl | sh`）。匹配到危险模式直接拦截。

### 可扩展的：PostToolUse 写文件日志

每次 Claude 写文件后自动记录一条日志，方便回溯：

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "node -e \"const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(new Date().toISOString(), 'WRITE', d.tool_input?.file_path || 'unknown')\" >> .claude/edit-log.txt"
          }
        ]
      }
    ]
  }
}
```

### 可扩展的：SessionStart 环境检查

每次 Claude Code 启动时自动检查环境：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "node -e \"console.log('CF_PAGES:', !!process.env.CF_PAGES, 'DATABASE_URL:', !!process.env.NUXT_DATABASE_URL)\""
          }
        ]
      }
    ]
  }
}
```

### Hook 的核心价值

让你**不用记住**要做什么检查——Hook 在关键节点自动执行。适合：
- 安全检查（你已经在做）
- 操作审计（记录谁改了什么）
- 环境验证（启动时检查依赖是否就绪）
- 通知推送（把关键操作推到外部系统）

---

## 5. Memory：跨会话记忆

### 场景

你在上周的一次调试中发现"Neon 从中国连接新加坡节点延迟 ~100ms"，但下周你可能已经忘了这个数字。Memory 系统让 Claude 帮你记住这些。

### 用法

**方式 1**：直接让 Claude 记住
> "记住 Neon 从中国到新加坡的延迟约 100ms，亚太约 30ms"

Claude 会写入 memory 文件，下次相关对话时自动召回。

**方式 2**：让 Claude 自己判断
Claude 会在技术讨论中自动判断哪些信息值得持久化——你在讨论中提到的偏好、决策、关键数据，Claude 可能会自动记录下来。

**方式 3**：查看已有记忆
> `/memory`

### 适合记住的内容

| 类型 | 示例 |
|------|------|
| 用户偏好 | "我喜欢用 Setup Store 语法写 Pinia" |
| 决策原因 | "选了 Drizzle 而不是 Prisma，因为 Edge Runtime 兼容性" |
| 踩坑数据 | "Neon 新加坡节点延迟 ~100ms，建议用亚太" |
| 环境细节 | "Windows 没有 jq，用 node 解析 JSON" |
| 项目约定 | "文件命名用 kebab-case，组件用 PascalCase" |

### 不适合的内容

- 代码实现细节（代码本身已经说了）
- git 历史能查到的事
- CLAUDE.md 已有的项目信息

### 和 CLAUDE.md / Rules 的关系

```
CLAUDE.md   → 每次加载，放全局性指令（架构、命令、规范）
Rules       → 按文件路径加载，放领域性约束（SSE、DB、前端）
Memory      → 按相关性召回，放经验数据（偏好、决策、踩坑）
```

三者各司其职，Memory 不能替代 CLAUDE.md 或 Rules。

---

## 6. Plan Mode：先设计再动手

### 场景

你说"给聊天加个导出功能"——这个需求涉及前端组件、API 路由、数据格式、可能还有新依赖。直接写代码容易漏、容易返工。Plan Mode 让 Claude **先探索、出方案、等你审批、再动手**。

### 用法

**触发方式**：
- 输入 `/plan` 进入计划模式
- 或直接说"先做个计划"
- 复杂任务时 Claude 会自动提议进入 Plan Mode

**流程**：
1. Claude 进入只读模式，探索代码库
2. 分析现有模式、考虑多种方案
3. 写出完整方案（改哪些文件、什么顺序、注意什么）
4. 你审批（可以提修改意见）
5. 确认后 Claude 开始实现

### 什么时候用

| ✅ 用 Plan Mode | ❌ 不用 Plan Mode |
|----------------|-------------------|
| 涉及 3+ 文件 | 改一行 typo |
| 有多种可行方案 | 已经明确知道怎么做 |
| 不可逆操作（数据库迁移等） | 调试 / 排查问题 |
| 架构层面的改动 | 加一个简单的 console.log |
| 不熟悉的代码区域 | 纯查询类任务 |

### 本项目的 Plan 输出

Plan Mode 产出的方案可以保存到 `.claude/plan/` 目录（和现有的 architecture.md、roadmap.md 放在一起），作为项目文档的一部分。

---

## 7. Permissions：安全与效率的平衡

已有详细指南 → [permissions-guide](permissions-guide.md)。这里强调一个**最容易踩的坑**。

### 关键陷阱：allow 优先级高于 deny

```
allow: ["Bash(git *)"]
deny:  ["Bash(git push *)"]    ← 失效！git push 先命中了 allow 的 git *
```

**正确做法**：allow 里不写通配符过大的规则，只精确放行安全命令：

```json
// ✅ 正确
"allow": [
  "Bash(git status *)",
  "Bash(git diff *)",
  "Bash(git log *)"
]
// git push 不在 allow 里，deny 可以兜底
```

### 权限最小化原则

每加一条 allow 规则时问自己：**"这条规则最坏情况下能造成什么破坏？"** 如果答案是"删代码"或"强制推送"，就不要加。

---

## 8. 进阶功能：Workflows / Cron / MCP

这些是需要前 7 项熟练后再学的功能，简要提一下使用场景：

### Workflows（多代理编排）

**场景**：不是派一两个子代理，而是**用 JS 脚本编排 10+ 个子代理协同**——比如"全面审查整个项目的 Edge 兼容性"，自动发现所有违规点、去重、验证、出报告。

**什么时候需要**：单个 Agent 工具不够用——任务需要流水线（A 的结果喂给 B）、条件分支、循环收集。

### Cron / 定时任务

**场景**："每天早上 9 点检查依赖更新"、"每 30 分钟检查一次构建状态"。

通过 `/loop` 命令或 `CronCreate` 工具创建定时任务。

### MCP 协议

**场景**：让 Claude 连接外部工具——比如直接查数据库、操作浏览器、调用企业内部 API。你的项目 Phase 2 会深入这个方向。

---

## 学习路线（推荐顺序）

```
第 1 周（基础增效）：
  Rules 机制理解 → Memory 系统 → 创建一个 Command → 用 TodoWrite 管理复杂任务

第 2-3 周（工作方式升级）：
  用 Agent 工具派子代理 → 创建 1-2 个 Custom Agent → 尝试 Plan Mode → 审查 Permissions 配置

第 4 周+（按需深入）：
  Workflows → Hooks 进阶 → Cron 定时任务 → MCP
```

---

## 本项目配置总览

| 机制 | 已配置 | 状态 |
|------|--------|------|
| Rules | 4 个（frontend、edge-runtime、sse、database） | ✅ 完善 |
| Skills | 1 个（doc-consolidate） | ✅ 可用 |
| Commands | 0 个 | 📝 建议创建 `/review` |
| Custom Agents | 0 个 | 📝 建议创建 `edge-reviewer` |
| Hooks | 1 个（PreToolUse bash guard） | ✅ 可用 |
| Permissions | allow 17 条 + deny 12 条 | ✅ 配置良好 |
| Plan Mode | 未使用过 | 📝 下次复杂任务试试 |
| Memory | 未主动使用 | 📝 下次讨论时说"记住" |
| Workflows | 未使用 | 🔮 Phase 2+ |
| MCP | 未接入 | 🔮 Phase 2+ |

---

## 相关文档

- [Commands vs Skills 详解](commands-vs-skills.md) — 两种扩展机制的深入对比
- [Hooks 指南](hooks-guide.md) — Hook 类型、exit code 语义、Windows 兼容
- [Permissions 指南](permissions-guide.md) — allow/deny 机制、最佳实践
