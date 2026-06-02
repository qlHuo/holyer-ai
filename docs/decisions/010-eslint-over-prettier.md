# ADR-010: ESLint stylistic rules 替代 Prettier

> 日期：2026-06-02 · 状态：✅ 已采纳

---

## 背景

项目初始化时已配置 `@nuxt/eslint`（Nuxt 官方 ESLint 模块），但代码风格规则仅启用两条（`commaDangle` + `braceStyle`），其余保持默认。前端开发者习惯的"ESLint 管质量 + Prettier 管格式"双工具方案尚未建立。

本次决策需要回答：**是否引入 Prettier？**

## 决策

**不引入 Prettier，由 ESLint stylistic rules 统一管理代码质量和代码风格。**

## 对比

| 维度 | ESLint + Prettier（双工具） | ESLint stylistic（单工具） |
|------|:---:|:---:|
| 格式化范围 | JS/TS/Vue (Prettier) + 质量检查 (ESLint) | JS/TS/Vue/CSS/HTML (全部由 ESLint 负责) |
| 配置冲突风险 | 高 — 需要 `eslint-config-prettier` 关闭 ESLint 中与 Prettier 冲突的规则 | 无 — 所有规则归 ESLint 管辖 |
| CI 速度 | 慢 — 两个工具串行检查 | 快 — 一条 `eslint . --fix` 搞定 |
| Nuxt 生态兼容 | 需额外配置才能与 `@nuxt/eslint` 协作 | ✅ `@nuxt/eslint` 内置支持 |
| 社区趋势 | 传统方案，存量项目主流 | 2025+ Nuxt 生态新默认（Anthony Fu 主导） |

## 关键理由

1. **`@nuxt/eslint` 已内置 `@stylistic/eslint-plugin`**：覆盖了 Prettier 90%+ 的格式化规则（引号、分号、缩进、尾逗号、空格、JSX 等），额外启用的 `formatters` 特性还能格式化 CSS/HTML
2. **避免 Prettier-ESLint 配置冲突**：双工具方案必然需要 `eslint-config-prettier` 做规则中转，增加一层间接性——而冲突总是发生在最不方便的时候（CI 报错但本地不报）
3. **工具链简化为一条命令**：`pnpm lint:fix` 同时完成质量检查和代码格式化
4. **Nuxt 生态方向**：`@nuxt/eslint` 的 `standalone` 模式明确设计为替代 Prettier，Nuxt 官方不再推荐 Prettier 插件

## 替代方案（已否决）

- **Prettier + eslint-config-prettier**：传统方案，但增加依赖和维护成本，且与 Nuxt 官方推荐方向背道而驰。如果未来项目迁移到非 Nuxt 框架，可作为后备方案重新评估

## 代价

- `.md` 文件的表格格式化不理想（Prettier 不理解 MDC 语法），已关闭 markdown formatter
- 需要团队成员理解 ESLint 现在同时负责格式和质量，不再只是"找 bug 的工具"
- `@typescript-eslint/consistent-type-imports` 等需要类型感知的规则无法启用（需要 `parserOptions.project`，对项目当前规模过重）

## 相关文档

- [2026-06-02 代码规范配置指南](../dev-log/2026-06-02-code-standards-setup.md)
- [ADR-008: Vercel AI SDK 不集成](008-vercel-ai-sdk.md) — 同样的"自建优于依赖"策略
- [架构设计](../../.claude/plan/architecture.md)
