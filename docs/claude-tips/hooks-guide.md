# Claude Code Hook 指南

---

## Hook 类型

| Hook | 触发时机 | 用途 |
|------|---------|------|
| `PreToolUse` | 工具调用执行**前** | 审批/拦截 |
| `PostToolUse` | 工具调用执行**后** | 日志/通知 |
| `Notification` | 事件通知 | 状态同步 |
| `SessionStart` | 会话开始 | 环境准备 |

## 本项目使用的 Hook

### PreToolUse — Bash 命令拦截

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/pre-bash-guard.sh"
          }
        ]
      }
    ]
  }
}
```

## 关键实现细节

### Windows 兼容：不用 jq

```bash
# ❌ 依赖 jq（Windows 默认没有）
cmd=$(echo "$stdin" | jq -r '.tool_input.command // ""')

# ✅ 用 node 解析 JSON（Windows/Linux/macOS 都有）
cmd=$(node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).tool_input?.command||'')}catch(e){console.log('')}})")
```

### Exit Code 语义

| Exit Code | 含义 |
|-----------|------|
| `0` | 放行，命令可以执行 |
| `1` | 非致命错误，仍放行 |
| `2` | **阻止**，命令被拦截并显示 stderr |

### 输出到 stderr 的重要

Hook 的 stdout 会被 Claude Code 内部解析，stderr 会展示给用户。所以拦截提示要写到 stderr：

```bash
echo "BLOCKED: 命令匹配危险模式 '$pattern'" >&2
echo "被阻止的命令: $cmd" >&2
exit 2
```

## 预置的危险模式

```bash
deny_patterns=(
  'rm\s+-rf\s+/'           # 递归删除根目录
  'rm\s+-rf\s+\/\*'        # 删除根下所有文件
  'rm\s+-rf\s+~'           # 删除 home 目录
  'rm\s+-rf\s+\$HOME'      # 删除 $HOME
  'git\s+push\s+--force'   # 强制推送
  'git\s+reset\s+--hard'   # 硬重置
  'curl.*\|\s*(ba)?sh'     # curl pipe shell（经典攻击向量）
  'wget.*\|\s*(ba)?sh'     # wget pipe shell
  'chmod\s+777\s+\/'        # 开放系统目录权限
)
```
