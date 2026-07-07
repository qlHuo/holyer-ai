# Commands vs Skills — Claude Code 的两种扩展机制

> 一句话：Command 是给人用的快捷方式，Skill 是给 Agent 用的能力扩展。Skill 也能被人手动触发。

---

## 核心区别

| | Commands (`commands/`) | Skills (`skills/`) |
|---|---|---|
| **触发者** | **人** — 输入 `/命令名` | **人 + Agent** — 手动触发 + Agent 自主调用 |
| **定义文件** | `.claude/commands/<name>.md` | `.claude/skills/<name>/SKILL.md` |
| **有无 frontmatter** | 无 | 有（`name`、`description`、`allowed-tools` 等） |
| **Agent 能调吗** | 不能 | 能 |
| **适用场景** | 固定流程的快捷操作 | 需要 Agent 判断"什么时候该用"的能力 |

## 自定义 Skill 的正确创建方式

### 目录结构

Skill 不是 flat file，而是一个子目录 + `SKILL.md`：

```
.claude/skills/<skill-name>/
├── SKILL.md              # 必需：指令 + YAML frontmatter
├── references/           # 可选：按需加载的参考资料
├── templates/            # 可选：文档模板
└── examples/             # 可选：示例输出
```

❌ `.claude/skills/my-skill.md` 不会被识别为 skill（只会被当作普通上下文加载）
✅ `.claude/skills/my-skill/SKILL.md` 正确格式

### 标准 Frontmatter 字段

```yaml
---
name: my-skill           # 必需：小写 + 连字符，最长 64 字符
description: >-          # 必需：用途 + 触发条件（最长 1024 字符）
  [做什么]。当用户输入 /my-skill、或说"关键词1""关键词2"时触发。
allowed-tools: [Read, Write, Edit, Glob, Grep]  # 可选：免确认的工具列表
disable-model-invocation: true  # 可选：禁止 Agent 自动触发
user-invocable: false           # 可选：从 / 菜单隐藏
model: sonnet                   # 可选：指定模型
---
```

> **注意**：`trigger` 不是标准 frontmatter 字段。触发条件写在 `description` 中，Claude Code 从描述里自动匹配。

### 触发方式

Skill 的触发靠 `description` 字段中描述的触发条件：

| 触发路径 | 机制 | 说明 |
|---------|------|------|
| 斜杠命令 `/skill名` | CLI 匹配 `commands/` + 系统提示匹配 `skills/` | 需要同名 command 桥接文件 |
| 自然语言关键词 | 模型识别 `description` 中的触发短语 | 如"归档""记录下来" |
| Agent 自主调用 | Agent 判断任务匹配 skill 描述 | 可被 `disable-model-invocation` 禁用 |

### Skill 不会自动注册为斜杠命令

**实测结论**：即使 Skill 的 `description` 中写了 `/doc-consolidate`，CLI 层也不会把它注册为 `/` 命令。CLI 优先拦截 `/` 输入，只在 `commands/` 目录中匹配。解决方案：保留一个最小化的 command 桥接文件（3 行），指向 skill 即可。

```
commands/doc-consolidate.md  →  注册 /doc-consolidate 斜杠命令入口
skills/doc-consolidate/SKILL.md  →  定义完整的执行逻辑
```

## 子代理（Subagents）

### 什么是子代理

Claude Code 的任务并行机制。把大任务拆成多个子任务，每个子代理独立搜索、独立读文件，互不污染上下文。

### 何时用

| 场景 | 代理类型 | 示例指令 |
|------|---------|---------|
| 广撒网搜索 | `Explore` | "找出项目里所有没有心跳的 SSE 端点" |
| 代码审查 | 自定义 agent | "审查 server/api/ 下所有文件的 Edge 兼容性" |
| 方案设计 | `Plan` | "设计 Phase 2 Agent 系统的技术方案" |
| 并行分析 | Explore × N | "分别分析 app/、server/、shared/ 的代码质量" |

### 自定义代理

在 `.claude/agents/` 下创建 `.md` 文件，定义专门的审查规则：

```markdown
---
name: code-reviewer
description: 审查代码变更，检查 SSE 心跳、Edge 兼容性、数据库规范
tools: [Read, Glob, Grep]
---

你是项目的代码审查员。审查时重点检查：
1. SSE 端点是否包含心跳机制
2. 是否引入 Node.js 专属 API
3. 数据库查询是否从 server/db/index.ts 导入
```

然后就可以在对话中直接调用：`"用 code-reviewer 审查上次提交"`

### 实际效果

本项目用 Explore 代理并行扫描了 useChat 引用（34,978 token，43s）和 SSE 文件（59,721 token，83s），两个任务互不阻塞，也不占用主对话上下文。

## 项目中的分层

| 目录 | 谁用 | 注册方式 |
|------|------|---------|
| `.claude/commands/` | 你（手动 `/`） | CLI 层次匹配文件名 → 斜杠命令 |
| `.claude/skills/` | 你 + Claude Code Agent | 目录 + SKILL.md → Skill 工具 + 自然语言 |
| `skills/` | 你的应用 AI Agent（Phase 2） | 面向最终用户的能力扩展 |

## 经验教训

本项目在配置 `doc-consolidate` 时踩过的坑：

1. **Flat file 不被识别**：`.claude/skills/doc-consolidate.md` 不会被注册为 skill，必须是 `.claude/skills/<name>/SKILL.md`
2. **`trigger` 不是标准字段**：触发条件靠 `description` 描述，不是 `trigger` YAML
3. **`tools` vs `allowed-tools`**：前者不会被解析，后者才是标准字段
4. **Skill ≠ 斜杠命令**：Skill 不会自动出现在 `/` 菜单，需要 command 桥接

## 相关文档

- [advanced-features-guide](advanced-features-guide.md) — 进阶功能全景实战指南
- [hooks-guide](hooks-guide.md)
- [permissions-guide](permissions-guide.md)
