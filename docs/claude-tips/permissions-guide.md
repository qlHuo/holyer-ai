# Claude Code 权限配置指南

> 相关文档：[进阶功能实战指南](advanced-features-guide.md) · [hooks-guide](hooks-guide.md)

---

## 核心机制

```
allow 列表  →  优先级最高，匹配即放行
deny 列表   →  次优先级，匹配即阻断
未命中      →  弹出用户确认
```

**关键陷阱**：allow 优先级高于 deny。如果 `allow` 中写了 `Bash(git *)`，`deny` 中的 `Bash(git push *)` 就无效了——因为 `git push` 先命中了 allow。

## 最佳实践

### 1. Allow 只放行"不会出事"的命令

```json
{
  "allow": [
    "Bash(npm install *)",
    "Bash(npm run *)",
    "Bash(git status *)",
    "Bash(git diff *)",
    "Bash(git log *)",
    "Bash(git branch *)",
    "Bash(ls *)",
    "Bash(cat *)"
  ]
}
```

**原则**：只给只读或纯增量操作的命令白名单。破坏性操作（push、delete、publish）不在此列。

### 2. Deny 做双重保险

```json
{
  "deny": [
    "Bash(rm *)",
    "Bash(sudo *)",
    "Bash(git push *)",
    "Bash(git reset *)"
  ]
}
```

Deny 是最后防线——即使 allow 误放了，deny 也能兜底。

### 3. 不给通配符过大权限

| ❌ 危险 | ✅ 安全 |
|---------|--------|
| `Bash(git *)` | `Bash(git status *)`, `Bash(git diff *)`, ... |
| `Bash(npm *)` | `Bash(npm install *)`, `Bash(npm run *)` |
| `Bash(wrangler *)` | `Bash(wrangler pages dev *)`, `Bash(wrangler whoami *)` |

### 4. PreToolUse Hook 做内容级拦截

权限 allow/deny 只匹配命令名，Hook 可以检查命令**内容**：

```bash
# 检查命令内容是否包含危险模式
deny_patterns=(
  'rm\s+-rf\s+/'
  'git\s+push\s+--force'
  'curl.*\|\s*(ba)?sh'
)
```

## 本项目配置

见 `.claude/settings.json` 的 `permissions` 字段。
