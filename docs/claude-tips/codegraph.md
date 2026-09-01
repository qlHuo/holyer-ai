# CodeGraph 接入 Claude Code

> 相关文档：[进阶功能实战指南](advanced-features-guide.md) · [权限配置指南](permissions-guide.md)

---

## 它是什么、为什么用

CodeGraph（npm 包 `@colbymchenry/codegraph`，即 [codegraph-ai/CodeGraph](https://github.com/codegraph-ai/CodeGraph)）是**第三方 MCP server**，为 AI 编码代理构建代码知识图谱：把符号（函数/类/模块）、调用关系、依赖提前建好索引，通过 MCP 暴露给 Claude Code / Cursor / Codex 等。

**核心价值**：用小代价的定向查询，替代「把整个仓库读一遍」的昂贵上下文消耗——`codegraph_search` / `callers` / `impact` 只返回相关片段，而不是整文件。

**关键性质**：它是**开发期本地工具**（跑在开发机 Node 环境），与项目的 Edge 部署（Cloudflare Workers / Neon）完全隔离，不引入任何生产依赖。

---

## 配置步骤

### 方式 1：npx 安装器（一条龙）

```bash
npx @colbymchenry/codegraph
```

安装器一次完成：装 CLI 到 PATH + 写 MCP 配置 + 写 CLAUDE.md 说明 + 设 auto-allow 权限。**只接线代理，不索引代码**，索引要单独跑 `codegraph init`。

### 方式 2：手动（拆开做，等价）

```bash
# 1. 全局装 CLI
npm install -g @colbymchenry/codegraph

# 2. 当前项目建图
cd 项目 && codegraph init -i

# 3. 项目级 MCP：项目根 .mcp.json
```

```json
// .mcp.json
{
  "mcpServers": {
    "codegraph": {
      "type": "stdio",
      "command": "codegraph",
      "args": ["serve", "--mcp"]
    }
  }
}
```


配置后**重启 Claude Code**，MCP server 才会加载。

![安装codegrpah-1](https://raw.githubusercontent.com/qlHuo/images/main/imgs/20260901231300252.png)

![安装codegrpah-2](https://raw.githubusercontent.com/qlHuo/images/main/imgs/20260901231350537.png)
---

## 配置注意点（最容易踩的坑）

### 1. 两个正交的「全局」，别混

| 维度 | 决定什么 | 选项 | 推荐 |
|------|----------|------|------|
| **CLI 装哪**（`codegraph` 可执行文件） | 命令行能否随时敲 `codegraph`；MCP 的 `"command"` 找不找得到 | `npm install -g` 全局 / 不装 | **全局**（必须） |
| **MCP 配置写哪**（`--location`） | 哪些 Claude Code 项目会加载这个 MCP | `global` → `~/.claude.json` / `local` → `.mcp.json` | **local**（项目级） |

两者**独立**：CLI 全局装，同时 MCP 只配当前项目，才是正确组合。

### 2. npx 不是「临时用」，是「临时跑安装器做永久配置」

`npx` 的「临时」只体现在**临时从 npm 拉包运行安装器**，跑完不残留。安装器干的活（装 CLI、写配置、后续 `init` 建索引）**全是永久**的。配完 npx 使命结束，以后用全局 `codegraph` 命令。

### 3. 决定项目级配置落地的，是 cwd，不是窗口类型

cmd/终端窗口本身**没有「全局 vs 项目」之分**，决定 `--location=local` 写到哪里的是**当前工作目录**：

- 先 `cd 项目` 再跑安装器 → `.mcp.json` 写进项目
- 在 `C:\Users\xxx` 这种非项目位置跑 → 「just this one」没地方落地，只能选全局

所以项目级配置的正确姿势是**先 cd 进项目再跑**。

### 4. 安装器交互两个关键选项

| 安装器的问题 | 怎么选 | 对应 |
|--------------|--------|------|
| 是否安装 codegraph 到 PATH？ | **Yes** | 全局装 CLI |
| Apply agent configs to all projects, or just this one? | **just this one** | 项目级 MCP |

---

## 团队协作

### 谁进仓库、谁不进

| 文件 | 性质 | 提交？ |
|------|------|--------|
| `.codegraph/`（codegraph.db、daemon.log、daemon.pid 等） | 索引**产物**，可重建 | ❌ 不提交 |
| `.codegraph/.gitignore` | 忽略规则文件 | ✅ **提交** |
| `.mcp.json` | 项目级 MCP 配置 | ✅ **提交** |
| `.claude/CLAUDE.md` / `.vscode/mcp.json` / `.codex/config.toml` | agent 说明/配置 | ⭕ 按团队是否用该 agent 决定 |

### codegraph 的巧妙设计：`.codegraph/.gitignore` 进仓库

codegraph 会在 `.codegraph/` 内自动生成：

```gitignore
*           # 忽略 .codegraph/ 下所有产物
!.gitignore # 但保留这个 .gitignore 文件本身
```

效果：**产物全部被忽略，只有 `.codegraph/.gitignore` 这个文件进仓库**。它提交后，团队其他人 clone 下来，即使不手动改根 `.gitignore`，本地产物也会被自动忽略——忽略规则跟着仓库传播。所以这个文件**是有意为之、该提交**，别把整个 `.codegraph/` 也 ignore 掉（否则等于把「忽略规则」也藏起来了）。

### onboarding（新成员三步）

```bash
npm install -g @colbymchenry/codegraph   # 1. 一次性全局装 CLI
git clone <仓库>                          # 2. .mcp.json 已在仓库，自动生效
codegraph init -i                         # 3. 本地建索引（各建各的，产物被忽略）
```

**配置共享，索引各自本地建**——`.mcp.json` 随 git 一致，`.codegraph/` 由每人本地文件监视器自动同步。

---

## 使用建议

MCP 暴露的工具以 `codegraph_` 为前缀，核心：`search`（符号搜索）、`node`（符号详情）、`callers`/`callees`（调用链）、`impact`（改动影响范围）、`explore`（一次性返回入口点+相关代码）、`status`（同步状态）。

**关键：别污染主会话上下文**

- ❌ 别在主会话直接调 `codegraph_explore` / `codegraph_context`——返回大量源码，填满主上下文
- ✅ 探索性问题（「X 怎么工作的」）交给 **Explore 子代理**，让它以 `codegraph_explore` 为主工具
- ✅ 主会话只在编辑前用轻量工具：`search` / `callers` / `callees` / `impact` / `node`

索引通过 OS 原生文件监视器自动同步（默认 2000ms 防抖），一般无需手动 `codegraph sync`；`codegraph status` 可随时验证。

## 卸载

```bash
codegraph uninstall   # 移除 MCP 配置、说明、权限
codegraph uninit      # 按项目删除 .codegraph/ 索引
```

## 命名陷阱

npm 上 `codegraph` 有多个包，主项目是 **`@colbymchenry/codegraph`**；另有 fork/衍生包（`@selvakumaresra/codegraph` 要求 Node 22.5+、`@astudioplus/codegraph-mcp` 等）。装前确认包名，以实际所装包文档为准。
