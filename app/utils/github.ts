/**
 * GitHub 引入（M4）— 浏览器直连封装 + markdown 图片相对路径改写
 *
 * 设计（详见 docs/dev-log/2026-09-09-github-doc-import-plan.md）：
 * - 只服务公开仓库：api.github.com / raw.githubusercontent.com 均对浏览器发 CORS *，零 token
 * - 纯浏览器逻辑，不经过 Worker（0 CF subrequest）；仅最后一步上传走本系统 /api/rag/documents
 * - resolveImageUrls 在 POST 前把相对图 URL 改写为绝对 raw URL，使 chunker 落库的 images 可被 M3 白名单放行
 */

// ==================== 类型 ====================

/** Git trees API 中一个待导入的 .md blob */
export interface RepoFile {
  /** 仓库内相对路径（含目录），如 "docs/guide.md" */
  path: string
  /** 字节大小（>500KB 的可预筛） */
  size: number
}

export interface TreeResult {
  files: RepoFile[]
  /** 超大仓库 trees 被 GitHub 截断时为 true */
  truncated: boolean
}

/** resolveImageUrls 的上下文：owner/repo/branch + 该文件所在目录（'' = 仓库根） */
export interface ResolveImageCtx {
  owner: string
  repo: string
  branch: string
  dir: string
}

/** 带 HTTP status 的 GitHub 请求错误（供前端按状态分型：404/限流 vs 网络） */
export class GitHubError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'GitHubError'
    this.status = status
  }
}

// ==================== 请求封装 ====================

function toGitHubError(status: number): GitHubError {
  let message: string
  if (status === 404) {
    message = '仓库或文件不存在（可能为私有仓库或已删除）'
  } else if (status === 403 || status === 429) {
    message = 'GitHub 限流，请稍后重试'
  } else if (status >= 500) {
    message = 'GitHub 服务暂时不可用'
  } else {
    message = `GitHub 请求失败（${status}）`
  }
  return new GitHubError(status, message)
}

/** 路径分段编码（保留 '/'，逐段 encodeURIComponent） */
function encodePathSegments(...parts: string[]): string {
  return parts
    .flatMap(p => p.split('/'))
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
}

/** GET /repos/{owner}/{repo} → 默认分支名（branch 未填时解析一次） */
export async function fetchDefaultBranch(owner: string, repo: string): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`)
  if (!res.ok) throw toGitHubError(res.status)
  const data = await res.json() as { default_branch?: string }
  if (!data.default_branch) throw new GitHubError(0, '无法解析默认分支')
  return data.default_branch
}

/** GET git/trees/{branch}?recursive=1 → 过滤 .md/.markdown 的 blob（保留 size 供超限预筛） */
export async function fetchMdTree(owner: string, repo: string, branch: string): Promise<TreeResult> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { headers: { Accept: 'application/vnd.github+json' } }
  )
  if (!res.ok) throw toGitHubError(res.status)
  const data = await res.json() as {
    tree?: Array<{ path?: string, type?: string, size?: number }>
    truncated?: boolean
  }
  const files: RepoFile[] = (data.tree ?? [])
    .filter(e => e.type === 'blob' && e.path && /\.(md|markdown)$/i.test(e.path))
    .map(e => ({ path: e.path!, size: e.size ?? 0 }))
  return { files, truncated: data.truncated === true }
}

/** GET raw.githubusercontent.com 原文（.md 文本）。signal 供批量循环「停止」中止在途请求 */
export async function fetchRawFile(
  owner: string, repo: string, branch: string, path: string, signal?: AbortSignal
): Promise<string> {
  const res = await fetch(
    `https://raw.githubusercontent.com/${owner}/${repo}/${encodePathSegments(branch, path)}`,
    { signal }
  )
  if (!res.ok) throw toGitHubError(res.status)
  return await res.text()
}

// ==================== 相对图片路径改写 ====================

/**
 * markdown 相对图片路径 → 绝对 raw URL（入库前调用）
 *
 * 规则（逐行扫描、跳过 ``` 代码围栏，防止改写示例代码里的假图片）：
 * - http(s):// 绝对 / // 协议相对 / data: → 原样保留
 * - 根相对 /img/a.png → {branch}/img/a.png
 * - 相对 ./img/x.png / img/x.png → {branch}/{dir}/img/x.png（先归一化 ../）
 * - ../ 归一化逃出仓库根 / 不可解析 → 原样保留（渲染层安全降级为文字，见 M3 白名单）
 * - 路径各段 encodeURIComponent（保留 '/'，兼容空格/中文文件名）
 *
 * 文件可放仓库任意目录，dir 取该 .md 所在目录（根目录为 ''）。
 */
export function resolveImageUrls(content: string, ctx: ResolveImageCtx): string {
  const lines = content.split('\n')
  let inCodeBlock = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock) continue

    lines[i] = line.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (whole, alt: string, url: string) => {
      const resolved = resolveRawUrl(url.trim(), ctx)
      if (resolved === null) return whole // 不可解析 → 原样保留，渲染层降级
      return `![${alt}](${resolved})`
    })
  }

  return lines.join('\n')
}

/** 单条图 URL → raw 绝对 URL；不可解析返回 null（保持原文） */
function resolveRawUrl(rawUrl: string, ctx: ResolveImageCtx): string | null {
  // 已是绝对 http(s) / 协议相对 / data → 不动
  if (/^(https?:)?\/\//i.test(rawUrl) || /^data:/i.test(rawUrl)) return null

  const cleanUrl = rawUrl.split(/[?#]/)[0]! // 去 query/hash（raw 路径不含）
  if (!cleanUrl) return null

  const isRootRelative = cleanUrl.startsWith('/')
  const rel = isRootRelative ? cleanUrl : cleanUrl

  // 归一化（含 ../），逃出仓库根返回 null
  const segs = (isRootRelative ? [] : ctx.dir.split('/')).concat(rel.split('/'))
  const out: string[] = []
  for (const seg of segs) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (out.length === 0) return null // 逃出仓库根
      out.pop()
      continue
    }
    out.push(seg)
  }

  const encoded = encodePathSegments(ctx.branch, out.join('/'))
  return `https://raw.githubusercontent.com/${ctx.owner}/${ctx.repo}/${encoded}`
}
