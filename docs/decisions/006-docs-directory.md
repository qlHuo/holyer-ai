# ADR-006: docs/ 目录结构与 .claude/ 分离

> 日期：2026-05-31 · 状态：✅ 已采纳

---

## 背景

项目需要存放开发日志、架构决策记录、Claude Code 使用技巧、学习笔记等文档。需要决定这些文档放在哪个目录，以及是否纳入 Claude Code 管理。

## 决策

**`docs/` 放在项目根目录**，不混入 `.claude/` 配置目录。

## 目录划分

```
holyer-ai/
├── .claude/          ← Claude Code 运行时配置（settings, hooks, rules, plan）
├── docs/             ← 项目文档资产（决策、日志、技巧、笔记）
│   ├── decisions/    ← 架构决策记录 (ADR)
│   ├── dev-log/      ← 开发过程记录（按日期）
│   ├── claude-tips/  ← Claude Code 使用技巧
│   └── learning-notes/ ← 技术学习笔记
├── app/
├── server/
└── ...
```

## 关键理由

1. **配置 vs 资产**：`.claude/` 是 Claude Code 的配置目录（类比 `.vscode/`），`docs/` 是项目文档资产，性质不同
2. **行业惯例**：`docs/` 在根目录是通用标准（`docs/decisions/` 符合 ADR 规范）
3. **Claude 自动可见**：根目录下文件 Claude 本来就能读，无需额外配置
4. **Git 可见性**：根目录 `docs/` 对贡献者更直观

## 不放入 `.claude/` 的理由

- `.claude/` 语义为"Claude Code 运行时目录"，放入开发日志会模糊边界
- `.claude/` 未来可能被 gitignore（某些团队做法），文档有丢失风险
