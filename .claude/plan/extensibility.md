# 扩展性设计

> 关联文档：[架构设计](architecture.md) · [需求分析](requirements.md) · [实施路线图](roadmap.md)

本文档评估未来可能的功能扩展，分析其成本和路径，并给出 Phase 1 即可落实的低成本准备方案。

---

## 1. 扩展总览

| 扩展功能 | 成本 | 架构影响 | 推荐阶段 |
|----------|:---:|:---:|:---:|
| API Key 管理 | 低（~1 天） | 纯增量添加 | Phase 2 |
| 用户登录系统 | 中（~2-3 天） | 需引入认证框架，所有表加 user_id | Phase 3 |
| 权限控制 | 中（~1 天） | 在用户系统之上增量 | Phase 4 |
| 多租户 | ❌ 舍弃 | 贯穿全栈修改，成本过高 | — |

---

## 2. API Key 管理（✅ 容易扩展）

### 2.1 现状 vs 目标

```
现在：    环境变量中一个 API Key → 整个应用共享
目标：    users 表 → user_api_keys 表 → 每个用户多个 Key，对应不同 Provider
```

### 2.2 需要的改动

**数据库**：
```sql
-- 新增表
CREATE TABLE user_api_keys (
  id          UUID PRIMARY KEY,
  user_id     UUID REFERENCES users(id),
  provider    VARCHAR(50) NOT NULL,    -- openai / anthropic / deepseek
  key_hash    VARCHAR(255) NOT NULL,   -- 加密存储，不可逆
  masked_key  VARCHAR(20) NOT NULL,    -- 如 "sk-...x9a2"
  created_at  TIMESTAMP DEFAULT NOW()
);
```

**后端**：
- `server/utils/auth.ts` 从简单校验升级为查表校验
- 新增 `/api/keys/` CRUD 路由
- Key 加密存储（`crypto.subtle` 或环境变量密钥加密）

**前端**：
- 设置页新增 API Key 管理面板
- 支持按 Provider 添加/删除 Key
- Key 仅输入时可见，列表仅显示后 4 位

### 2.3 实施要点

- 加密 Key 永远不入日志
- API 返回 Key 列表时不包含原始值
- Provider 调用时按优先级选择 Key（用户个人 Key > 系统默认 Key）

---

## 3. 用户登录系统（⚠️ 中等扩展）

### 3.1 现状 vs 目标

```
现在：    无用户概念，所有数据全局共享
目标：    用户注册/登录，数据按用户隔离，Session 管理
```

### 3.2 认证方案选型

| 方案 | 推荐度 | 说明 |
|------|:---:|------|
| **`@sidebase/nuxt-auth`** | ⭐⭐⭐⭐ | Nuxt 4 原生支持，封装 NextAuth.js，OAuth 开箱即用 |
| **Lucia Auth v3** | ⭐⭐⭐ | 较新，更灵活但需手动集成 |
| **自建 JWT** | ⭐⭐ | 完全可控但工作量大（token 刷新、黑名单等） |

**推荐 `@sidebase/nuxt-auth`**，理由是 Nuxt 4 官方生态、支持 GitHub/Google OAuth、Session 管理成熟。

### 3.3 需要的改动

**数据库**：
```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),           -- OAuth 用户可为 NULL
  name          VARCHAR(100),
  avatar        VARCHAR(500),
  role          VARCHAR(20) DEFAULT 'user',  -- admin | user
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE sessions (
  id          UUID PRIMARY KEY,
  user_id     UUID REFERENCES users(id),
  expires_at  TIMESTAMP NOT NULL
);
```

**后端**：
- 新增 `server/middleware/auth.ts` 全局鉴权中间件
- 登录/注册/OAuth回调 API
- 现有所有 API 路由加上鉴权守卫
- **所有现有表加 `user_id` 外键**（conversations, messages, skills, knowledge_bases）

**前端**：
- 登录/注册页面
- OAuth 按钮（GitHub、Google）
- 用户头像 + 下拉菜单（设置、退出）
- 路由守卫（未登录跳转登录页）

### 3.4 这是最大的"技术债"

当前架构中最大的简化是**没有用户概念**。引入用户系统时：
- 所有查询从 `db.select().from(conversations)` 变为 `db.select().from(conversations).where(eq(conversations.userId, ctx.userId))`
- 每个 API handler 需要解析当前用户身份
- 数据库迁移需要处理已有数据（给现有记录分配用户或清空）

---

## 4. 权限控制（⚠️ 中等扩展）

### 4.1 角色模型

权限控制在用户系统就绪后是自然增量，保持简单的三级角色：

```
admin   → 全部权限（管理 API Key、系统配置、查看所有对话）
user    → 管理自己的对话、Skills、知识库（默认角色）
viewer  → 只读（预留，如分享场景）
```

### 4.2 需要的改动

**数据库**：
```sql
-- users 表加 role 字段（已在 3.3 中包含）
ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'user';
```

**后端**：
- `server/middleware/rbac.ts` 角色检查中间件
- 定义 `Permission` 枚举 + `RolePermissions` 映射

```ts
// server/utils/permissions.ts
const RolePermissions = {
  admin:  ['*'],
  user:   ['chat:*', 'conversation:*', 'skill:read', 'rag:*'],
  viewer: ['chat:read', 'conversation:read'],
}
```

**前端**：
- 按角色控制 UI 渲染（`v-if="userStore.isAdmin"`）
- 管理员面板（用户列表、系统配置）

### 4.3 实施前提

权限系统**依赖用户系统先落地**，不可跳跃。如果直接做权限不做用户，等于没有载体。

---

## 5. 扩展顺序建议

```
Phase 1  →  个人版（当前设计）         ← 现在
Phase 2  →  + API Key 管理             ← 成本最低，收益最大
Phase 3  →  + 用户登录系统             ← 引入用户概念，这是关键节点
Phase 4  →  + 权限控制                 ← 在用户基础上自然增量
```

**不建议跳跃式演进**——比如从 Phase 1 直接跳到权限控制，因为缺少用户系统这一中间层会导致大量返工。

---

## 6. Phase 1 即可落实的低成本准备

以下措施在 Phase 1 实施时落地，成本几乎为零，但能让后续扩展从"重构"降级为"增量添加"：

### 6.1 `auth.ts` 抽成函数

```ts
// ❌ 不好：硬编码在路由中
export default defineEventHandler(async (event) => {
  const apiKey = useRuntimeConfig().apiKey
  // ... 业务逻辑
})

// ✅ 好：通过可替换的函数获取上下文
// server/utils/auth.ts
export async function getAuthContext(event: H3Event): Promise<AuthContext> {
  // Phase 1: 返回固定上下文
  return { userId: 'default', role: 'admin' }

  // Phase 3: 从 session 解析
  // const session = await getSession(event)
  // return { userId: session.userId, role: session.user.role }
}

interface AuthContext {
  userId: string
  role: 'admin' | 'user' | 'viewer'
}
```

### 6.2 数据查询通过上下文过滤

```ts
// ✅ 所有 Service 方法接受 AuthContext
async function getConversations(ctx: AuthContext) {
  return db.select()
    .from(conversations)
    .where(eq(conversations.userId, ctx.userId))  // 从第一天就带过滤
}

// Phase 1 时 ctx.userId 永远是 'default'
// Phase 3 时 ctx.userId 就是真实用户 ID —— 业务代码不用改
```

### 6.3 API 路由不自己解析用户

```ts
// ❌ 不好
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const userId = body.userId  // 信任客户端传入？安全风险！
})

// ✅ 好
export default defineEventHandler(async (event) => {
  const ctx = await getAuthContext(event)  // 从服务端解析
  const conversations = await getConversations(ctx)
})
```

### 6.4 表设计预留 user_id

```ts
// server/db/schema.ts — 所有业务表从第一天就带 user_id
export const conversations = pgTable('conversations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().default('default'),  // ← 预留
  title: text('title').notNull(),
  model: text('model'),
  createdAt: timestamp('created_at').defaultNow(),
})
```

### 6.5 环境变量命名留扩展空间

```bash
# ❌ 不够清晰
API_KEY=sk-xxx
OPENAI_KEY=sk-xxx

# ✅ 按 Provider 命名，后续易于切换为用户级配置
PROVIDER_OPENAI_API_KEY=sk-xxx
PROVIDER_ANTHROPIC_API_KEY=sk-ant-xxx
PROVIDER_DEEPSEEK_API_KEY=sk-xxx
AUTH_SECRET=your-secret-here     # 预留，用户系统需要
```

### 6.6 检查清单

Phase 1 结束时确认：

- [ ] 所有 API 路由通过 `getAuthContext()` 获取用户上下文（不信任客户端传入的 user 信息）
- [ ] 所有 Service 方法接受 `AuthContext` 参数
- [ ] 所有业务表（conversations, messages）带 `user_id` 字段
- [ ] API Key 存储在环境变量并通过 Provider 名称索引
- [ ] `auth.ts` 是单一入口，未来改一行即可切换认证方式

---

## 7. 明确舍弃：多租户

多租户不在规划范围内，原因：

| 项 | 说明 |
|----|------|
| **成本** | 所有表加 `tenant_id`，所有查询加租户过滤，新增 teams/invitations/members 表 |
| **复杂度** | 数据隔离（RLS 或应用层过滤）、成员邀请流程、租户切换 UI |
| **收益** | 个人工具不需要组织管理能力 |
| **替代** | 如果需要分享，可通过"只读分享链接"实现，不建完整多租户体系 |

如果未来真的需要多租户，应在用户系统（Phase 3）和权限控制（Phase 4）全部落地后再考虑，届时架构已具备基础的用户和权限模型，加租户隔离是增量而非重建。
