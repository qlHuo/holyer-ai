#!/usr/bin/env bash
set -euo pipefail

# PreToolUse hook — 在 Bash 命令执行前拦截危险操作
# stdin 收到 JSON: { "tool_input": { "command": "..." } }
# exit 0 = 放行, exit 2 = 阻止（stderr 消息会反馈给 Claude）
# 用 node 解析 JSON（Windows 兼容，不依赖 jq）

cmd=$(node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).tool_input?.command||'')}catch(e){console.log('')}})")

# 危险命令模式（正则，大小写不敏感）
deny_patterns=(
  'rm\s+-rf\s+/'           # 删除根目录
  'rm\s+-rf\s+\/\*'        # 删除根目录所有文件
  'rm\s+-rf\s+~'           # 删除用户目录
  'rm\s+-rf\s+\$HOME'      # 删除 HOME
  'git\s+push\s+--force'   # 强制推送
  'git\s+reset\s+--hard'   # 硬重置
  'curl.*\|\s*(ba)?sh'     # curl pipe shell
  'wget.*\|\s*(ba)?sh'     # wget pipe shell
  'chmod\s+777\s+\/'       # 危险权限提升
)

for pattern in "${deny_patterns[@]}"; do
  if echo "$cmd" | grep -Eiq "$pattern"; then
    echo "BLOCKED: 命令匹配危险模式 '$pattern'" >&2
    echo "被阻止的命令: $cmd" >&2
    exit 2
  fi
done

exit 0
