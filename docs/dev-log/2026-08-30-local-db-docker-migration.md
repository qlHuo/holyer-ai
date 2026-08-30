# 2026-08-30 — 本地开发库迁移到 Docker + pgvector 启用

> 核心洞察：pgvector 在 Windows 原生装只有「编译」或「第三方 dll」两条窄路，而 Docker 官方镜像一条命令搞定——且「装好」和「激活」是两件事，`CREATE EXTENSION` 是给**单个数据库**「开机」。

---

## 讨论背景

RAG（Phase 3）开工前，`chunks` 表需要一个 `vector(1024)` 列，这依赖 PostgreSQL 的 pgvector 扩展。而项目本地开发库是**原生 Windows 装的 PostgreSQL 17**（`C:\Program Files\PostgreSQL\17`，服务名 `postgresql-x64-17`），默认**不带** pgvector。

要在本地装上 pgvector，三条路：

| 路径 | 做法 | 问题 |
|------|------|------|
| 源码编译 | Visual Studio Build Tools + `nmake /F Makefile.win` | 太重，不适合 |
| 非官方预编译包 | 从第三方 GitHub 仓库下载 `.dll` | ⚠️ 安全 + 版本匹配风险 |
| **Docker 官方镜像** | `pgvector/pgvector:pg17` | ✅ 官方、版本匹配、可逆 |

## 决策：选 Docker

选 Docker（`pgvector/pgvector:pg17` 镜像），而不是原生装非官方预编译包。理由：

1. **官方可信**：镜像由 pgvector 项目维护，不往数据库进程塞第三方 `.dll`
2. **版本匹配**：镜像内 PG 与 pgvector 版本永远配套，不存在「在 17.6 测过、你是 17.10」的隐患
3. **可逆**：原生 PG 不删，随时切回
4. **主流实践**：Docker 跑本地数据库是团队开发的标准做法
5. **已装**：Docker Desktop 本机已有

代价：开发库从原生迁到容器（一次性 `pg_dump`/`pg_restore`，或重建空库）。

---

## 完整步骤（一步一步）

### 第 0 步：探测环境

先搞清楚原生 PG 怎么装的、服务名是什么（停服务那步要用）：

```bash
net start | grep -i postgres
# → postgresql-x64-17 - PostgreSQL Server 17
```

### 第 1 步：启动 Docker Desktop

从开始菜单打开 Docker Desktop，等鲸鱼图标停止动画。验证：

```bash
docker ps   # 不报 "daemon 未运行" 即就绪
```

### 第 2 步：导出原生库数据（可跳过，不保留旧数据时）

趁原生 PG 还开着，把 `holyer` 库导成文件（`-F c` 是 custom 格式，`pg_restore` 最友好）：

```powershell
$env:PGPASSWORD = "postgres"    # PowerShell 设一次，后续命令不用再带密码
cd D:\workspace\holyer-ai
pg_dump -U postgres -h localhost -p 5432 -d holyer -F c -f holyer.dump
```

### 第 3 步：停掉原生 PG 服务

容器要占 5432 端口，先空出来（需管理员权限，报 `System error 5` 就是没权限）：

```powershell
net stop postgresql-x64-17
```

### 第 4 步：启动容器

用 `compose.yaml`（见项目根目录 [compose.yaml](../../compose.yaml)），一条命令：

```powershell
docker compose up -d    # 首次拉镜像 + 建容器；之后启动已存在的容器
```

`compose.yaml` 关键配置：

```yaml
services:
  db:
    image: pgvector/pgvector:pg17
    container_name: holyer-pg
    environment:
      POSTGRES_PASSWORD: postgres   # 和原来一致，.env 不用改
      POSTGRES_DB: holyer           # 首次启动自动建库
    ports: ['5432:5432']            # 宿主机 5432 → 容器 5432
    volumes:
      - holyer-pg-data:/var/lib/postgresql/data   # 命名卷：容器删了数据还在
    restart: unless-stopped         # Docker 起来容器跟着起
```

### 第 5 步：恢复数据（可跳过）

容器里已建好空的 `holyer`，把第 2 步的 dump 导回去：

```powershell
pg_restore -U postgres -h localhost -p 5432 -d holyer --clean --if-exists holyer.dump
```

### 第 6 步：启用 pgvector 并验证 ⭐

```sql
CREATE EXTENSION IF NOT EXISTS vector;
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
-- 预期：vector | 0.8.x
```

### 第 7 步：验证连接

```sql
SELECT 1;   -- 返回 1 即通
```

### 第 8 步：收尾（配合开机自启的必需步骤）

原生 PG 默认「开机自启」，会和容器抢 5432。改成手动启动：

```powershell
sc config postgresql-x64-17 start= demand
```

---

## 核心概念

### 1. 装好了 ≠ 激活了

pgvector 是 PostgreSQL 的**扩展（extension）**，两段状态：

| 表 | 问的问题 | 说明 |
|----|---------|------|
| `pg_available_extensions` | 装了吗？ | 二进制文件在不在（镜像自带，所以有 `vector`） |
| `pg_extension` | 激活了吗？ | 跑过 `CREATE EXTENSION` 才有 |

装好（镜像内置）和激活（`CREATE EXTENSION`）是两码事——就像浏览器装了插件，还得在插件管理里「启用」。

### 2. 扩展是 per-database 的

`CREATE EXTENSION vector` 是**按数据库**启用的，不是全局。在 `holyer` 库里启用了，新建别的库还要单独跑一次。

### 3. docker run / docker start / docker compose 的区别

| 命令 | 语义 |
|------|------|
| `docker run` | 「创建 + 启动」（只在第一次需要） |
| `docker start` | 「启动已存在的容器」（日常用） |
| `docker compose up -d` | 按 `compose.yaml` 启动（配置沉淀进项目，进 git） |

容器是**持久**的，日常开发不是重跑 `docker run`，而是启动已存在的容器。

---

## 踩坑记录

1. **PowerShell 不认 `PGPASSWORD=x cmd`**：那是 bash 语法。PowerShell 要先 `$env:PGPASSWORD = "postgres"` 再单独跑命令。
2. **PowerShell 不认 `\` 换行**：多行 `docker run` 里的 `\` 会被当成反斜杠，要么写单行，要么用反引号 `` ` ``。
3. **端口 5432 冲突**：原生 PG 和容器都想占 5432，必须先停原生（第 3 步）。
4. **DBeaver 报 SCRAM 认证错误**：「no password was provided」是密码**没填**（不是填错），编辑连接补上 `postgres` 即可。
5. **首次 `docker compose up` 要等**：拉镜像几百 MB + 容器初始化 5~10 秒，别急着连。

---

## 关键洞察

- Docker 跑本地数据库是主流实践：环境一致、一条命令、版本干净、删容器即卸载
- `compose.yaml` 把容器配置绑定进项目（进 git），是「工程化」的一环，优于散落在命令行历史的 `docker run`
- pgvector 的「装好 vs 激活」两段式，本质是 PG 扩展的通用机制——理解这一点，以后装任何 PG 扩展都同理

## 相关文档

- [pgvector 笔记](../learning-notes/pgvector.md) — 向量列、距离运算符、维度不可逆
- [Embedding 维度与 Matryoshka](../learning-notes/embedding-dimensions.md) — 为什么锁 1024
- [RAG 知识库完整设计](2026-08-19-rag-knowledge-base-design.md) — `chunks` 表为什么要 `vector` 列
- [数据库规则](../../.claude/rules/database.md) — 本地/生产双驱动、连接串规范
