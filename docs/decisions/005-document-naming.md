# ADR-005: 项目文档英文命名

> 日期：2026-05-31 · 状态：✅ 已采纳

---

## 背景

`.claude/plan/` 文档最初用英文命名，后尝试改为中文（如 `需求分析.md`），需要决定最终命名规范。

## 决策

**使用英文文件名**，`.claude/plan/` 和 `docs/` 均统一使用英文命名。

## 关键理由

1. **CLI/Shell 兼容性**：中文文件名在终端中需要转义或 IME 切换，降低效率；Tab 补全不友好
2. **Git 兼容性**：Windows/macOS/Linux 中文编码处理不一致可能导致乱码
3. **Claude Code 引用**：`@` 路径引用时英文更短更精确
4. **国际化惯例**：开源项目通用做法

## 最终结构

```
.claude/plan/
├── architecture.md
├── extensibility.md
├── requirements.md
├── roadmap.md
└── technical-research.md

docs/
├── decisions/
├── dev-log/
├── claude-tips/
└── learning-notes/
```

## 代价

- 对中文母语者略不直观
- 文件名和文档标题语言不一致（文件名英文，内容中文）
