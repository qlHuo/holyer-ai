# Nuxt 4 学习笔记

---

## 目录结构变化（v3 → v4）

```
v3:  pages/ components/ composables/ server/
v4:  app/pages/ app/components/ app/composables/ server/
```

前端代码移入 `app/` 目录，服务端 `server/` 保持根层级。

## Nitro 服务端关键能力

- **文件系统路由**：`server/api/chat/index.post.ts` → `POST /api/chat`
- **SSE 原生支持**：`sendStream()` 返回 `ReadableStream`
- **中间件**：`server/middleware/auth.ts` 全局鉴权
- **运行时配置**：`useRuntimeConfig()` 读取环境变量

## Nuxt UI v4 Chat 组件套件

| 组件 | 用途 |
|------|------|
| `ChatMessages` | 消息列表容器 |
| `ChatPrompt` | 输入框（含附件、发送按钮） |
| `ChatReasoning` | 模型推理过程（折叠展示） |
| `ChatTool` | 工具调用卡片 |
| `ChatShimmer` | 加载占位动画 |

## Nuxt UI v4 使用要点

- 通过 `@nuxt/ui` 模块注册，不是插件
- 暗黑模式使用 `useColorMode()` composable
- 组件样式通过 `ui` prop 覆盖，不是传统的 class 覆盖
- Tailwind CSS v4 **不需要** `tailwind.config.ts`——使用 CSS 驱动的 `@theme` 指令

## 路径别名

```
~~/  →  项目根目录
~/   →  app/ 目录（Nuxt 4）
```

引用 server 层代码：`import { db } from '~~/server/db'`

## Cloudflare Pages 构建

```bash
npx nuxi build                # 自动使用 cloudflare-pages preset
npx wrangler pages dev dist/  # 本地验证
```

需在 `nuxt.config.ts` 配置：
```ts
export default defineNuxtConfig({
  nitro: {
    preset: 'cloudflare-pages'
  }
})
```

## 依赖 Edge 兼容性检查清单

新依赖加入前检查：
1. 是否依赖 `fs` / `child_process` / `net` 模块？
2. 是否使用 `require()` 动态加载？
3. 是否发起原始 TCP 连接？
4. 是否有 `window` / `document` 引用（SSR 安全）？

三项任一为"是"就不能用。
