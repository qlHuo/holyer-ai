# 2026-06-02 — CI/CD 初始配置：策略与时机

> CI 的价值随项目阶段递增——单人开发期它只是"占位"，但从 PR 协作开始变得不可替代。

---

## 讨论背景

项目初始化时自动生成了 `.github/workflows/ci.yml`，但三个 GitHub Action 版本号错误（`@v6` 不存在，正确应为 `@v4`），且当前阶段跑 CI 的实际价值存疑。

---

## 1. 当前 CI 配置

```yaml
name: ci
on: push

jobs:
  ci:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest]
        node: [22]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: pnpm
      - run: pnpm install
      - run: pnpm run lint
      - run: pnpm run typecheck
```

当前只跑 `lint` + `typecheck`，无 test、无 build。

---

## 2. 修复记录

| 问题 | 原因 | 修复 |
|------|------|------|
| `actions/checkout@v6` 不存在 | 这三个 Action 最高只有 v4 | → `@v4` |
| `pnpm/action-setup@v6` 不存在 | 同上 | → `@v4` |
| `actions/setup-node@v6` 不存在 | 同上 | → `@v4` |

不加修复 CI 会直接报 "action not found"，等同于没有 CI。

---

## 3. Matrix 策略说明

```yaml
strategy:
  matrix:
    os: [ubuntu-latest]
    node: [22]
```

`matrix` 是 GitHub Actions 内置特性，**不需要在 GitHub 仓库页面上配置任何东西**。两个变量（`os`、`node`）当前都只有一个值，产出一个 job（1×1=1）。

`matrix` 的真正威力在扩展时体现——只需加值就自动生成并行 job：

```yaml
# 未来需要测多版本时
node: [22, 24]              # → 2 个 job 并行
os: [ubuntu-latest]          # 如果需要跨平台再加 win/mac
```

---

## 4. 当前阶段 CI 的实际价值

### 单人开发期（现在）：用处不大

CI 跑的事和本地 100% 重复：

| CI 步骤 | 你本地 |
|---------|--------|
| `pnpm run lint` | VS Code 保存时 ESLint 自动 fix |
| `pnpm run typecheck` | `npx nuxi typecheck`（偶尔跑） |

每次 push 在 GitHub 服务器上重放一遍，能发现的问题本地早发现了。

### CI 真正的价值拐点

| 阶段 | 触发条件 | CI 价值 |
|------|---------|:---:|
| 单人开发 | — | 占位，用处不大 |
| 有人提 PR | 需要 code review 前自动验证 | ✅ 拦住低级错误 |
| 多人协作 | 各自环境不同 | ✅ 保证一致性 |
| 有测试 | 本地跑全部测试太慢 | ✅ 并行执行 |
| 自动部署 | 推到 main 自动上线 | ✅ 不可替代 |

### 保留还是删除？

**保留**。lint + typecheck 十几秒跑完，几乎不消耗 Actions 额度。它相当于一个"占位符"——确保 CI 通道畅通，等加了测试和部署后直接扩展即可。

---

## 5. 后续扩展方向

当前 CI 只有两个 step，是刻意精简的。后续按需扩展：

```
Phase 1 现在           Phase 2+ 加测试           Phase 3+ 加部署
─────────────         ─────────────────        ─────────────────
lint                  lint                      lint
typecheck             typecheck                 typecheck
                      test (vitest)             build
                                                test
                                                deploy → Cloudflare Workers
```

扩展时关注：
- **`on` 触发条件细化**：当前 `on: push` 每次 push 都跑；以后可以改为 `on: push: { branches: [main] }` + `on: pull_request`
- **缓存策略**：`setup-node` 的 `cache: pnpm` 已处理依赖缓存，之后如果 RAG 有大型静态文件需要额外 cache
- **环境变量**：当前不需要（lint/typecheck 不调 API），加测试后可能需要 `DATABASE_URL` 等 secrets

---

## 关键洞察

- **CI 配置错误不是"功能暂缺"，是通道堵死**：版本号错误 = CI 完全不可用 = 等于没有。这类配置错误应该立刻修，不等"到了需要 CI 的阶段"
- **Matrix 的价值在于一维扩展**：当前 `node: [22]` 只有一个值看不出威力，但理解了"单值变数组 = 自动 N 倍并行 job"，就不会觉得它多余
- **占位 CI > 没有 CI**：即使现在用处不大，保留 CI 文件意味着通道畅通——哪天要加测试、要限制 PR，改一行 YAML 就行，不用从头折腾

## 6. 首次 CI 拦截：runtimeConfig 类型安全

CI 通道跑通后首次成功拦截了一个真实 bug——`pnpm run typecheck` 报错：

```
Error: server/service/llm/factory.ts(33,9): error TS2322:
  Type 'unknown' is not assignable to type 'string | undefined'.
Error: server/service/llm/factory.ts(50,9): error TS2322:
  Type 'unknown' is not assignable to type 'string | undefined'.
```

### 根因

`factory.ts` 访问了 `config.openaiBaseUrl` 和 `config.deepseekBaseUrl`，但这两个 key 在 `nuxt.config.ts` 的 `runtimeConfig` 中**没有声明**。Nuxt 对未声明的 `runtimeConfig` key 推断类型为 `unknown`，而不是 `string | undefined`，与 Provider 构造函数期望的类型不兼容。

### 修复

在 `nuxt.config.ts` 的 `runtimeConfig` 中声明所有访问过的 key：

```ts
runtimeConfig: {
  databaseUrl: '',
  openaiApiKey: '',
  openaiBaseUrl: '',       // ← 补声明
  anthropicApiKey: '',
  anthropicBaseUrl: '',    // ← 补声明
  deepseekApiKey: '',
  deepseekBaseUrl: ''      // ← 补声明
},
```

### 关键教训

**Nuxt runtimeConfig 的类型推断规则**：`runtimeConfig` 中声明的 key → 类型为 `string`（默认值类型）；未声明的 key → 类型为 `unknown`。访问未声明的 key 不会在运行时报错（Nitro 会从环境变量注入），但 TypeScript 编译时会因类型不匹配而失败。

**规则**：只要 `useRuntimeConfig()` 中访问了一个 key，就必须在 `nuxt.config.ts` 的 `runtimeConfig` 中声明它。这是 Nuxt 的"声明即类型"模式——`runtimeConfig` 不仅是默认值，更是类型定义的唯一真相源。

### 这次拦截证明了 CI 的价值

这个 bug 本地 `npx nuxi typecheck` 也能发现，但实际开发中很少手动跑。CI 在 push 后自动拦截，阻止了一个会在后续 PR 中被发现的类型错误。即使单人开发期，CI 也是个有用的"自动检查员"。

## 相关文档

- [项目初始化完整指南](2026-05-31-scaffold-guide.md) — 项目脚手架搭建
- [架构设计](../../.claude/plan/architecture.md) — 部署架构（Cloudflare Workers）
- [实施路线图](../../.claude/plan/roadmap.md) — Phase 进度
- [Nuxt 4 学习笔记](../../docs/learning-notes/nuxt4-notes.md) — runtimeConfig 类型安全
