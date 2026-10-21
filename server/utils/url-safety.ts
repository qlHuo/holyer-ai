/**
 * 外部 URL 安全校验 — SSRF 防护
 *
 * 适用场景：用户可填写目标地址的服务端请求（网页抓取、MCP Server 探测等）。
 *
 * 限制：Edge Runtime 没有 dns 模块，无法做「域名解析后再判断 IP」的深度防护，
 * 因此不能完全防御 DNS rebinding。这里阻断的是最常见的字面量内网地址、
 * 保留地址与内网 TLD；配合调用方「不跟随重定向」，足以覆盖个人应用的主要风险。
 */

export type UnsafeUrlReason = 'invalid' | 'protocol' | 'credentials' | 'private-host'

export class UnsafeUrlError extends Error {
  constructor(message: string, readonly reason: UnsafeUrlReason) {
    super(message)
    this.name = 'UnsafeUrlError'
  }
}

export interface SafeUrlOptions {
  /**
   * 是否放行环回地址。
   * 只应在开发环境、且由调用方通过显式开关控制时开启（本地测试 MCP Server）。
   */
  allowLoopback?: boolean
}

/** 校验并返回 URL；不合法时抛出 UnsafeUrlError */
export function assertSafeHttpUrl(raw: string, options: SafeUrlOptions = {}): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new UnsafeUrlError('URL 格式无效', 'invalid')
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new UnsafeUrlError('仅支持 http:// 和 https:// 协议的 URL', 'protocol')
  }

  if (url.username || url.password) {
    throw new UnsafeUrlError('URL 不允许包含用户名或密码', 'credentials')
  }

  if (isPrivateHostname(url.hostname) && !(options.allowLoopback && isLoopbackHostname(url.hostname))) {
    throw new UnsafeUrlError('出于安全考虑，不允许访问内网或保留地址', 'private-host')
  }

  return url
}

/** 环回地址：localhost / 127.0.0.0/8 / ::1 */
export function isLoopbackHostname(hostname: string): boolean {
  const h = normalizeHostname(hostname)
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true

  const ipv4 = parseIpv4(h)
  return ipv4 !== null && ipv4[0] === 127
}

/** 内网 / 保留地址判断 */
export function isPrivateHostname(hostname: string): boolean {
  const h = normalizeHostname(hostname)

  // 环回
  if (isLoopbackHostname(h)) return true

  // IPv6 未指定地址
  if (h === '::' || h === '0:0:0:0:0:0:0:0') return true

  // IPv4-mapped IPv6：::ffff:127.0.0.1
  // URL 通常会把点分形式规范化为十六进制（::ffff:7f00:1），两种都要处理
  const mappedDotted = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mappedDotted) {
    const ipv4 = parseIpv4(mappedDotted[1]!)
    return ipv4 === null || isPrivateIpv4(ipv4)
  }

  const mappedHex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (mappedHex) {
    const hi = Number.parseInt(mappedHex[1]!, 16)
    const lo = Number.parseInt(mappedHex[2]!, 16)
    return isPrivateIpv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff])
  }

  // IPv6 唯一本地地址 fc00::/7 与链路本地 fe80::/10
  const firstGroup = h.split(':')[0] ?? ''
  if (/^f[cd]/i.test(firstGroup)) return true
  if (/^fe[89ab]/i.test(firstGroup)) return true

  const ipv4 = parseIpv4(h)
  if (ipv4) return isPrivateIpv4(ipv4)

  // 内网保留 TLD
  return /\.(internal|local|lan|home|corp|intranet)$/.test(h)
}

/** URL.hostname 对 IPv6 返回带方括号；同时去掉末尾点（localhost.） */
function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
}

function parseIpv4(hostname: string): [number, number, number, number] | null {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!match) return null

  const parts = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])] as const
  if (parts.some(part => part > 255)) return null
  return [parts[0], parts[1], parts[2], parts[3]]
}

function isPrivateIpv4([a, b, c]: [number, number, number, number]): boolean {
  if (a === 0 || a === 10 || a === 127) return true // 0/8 · 10/8 · 127/8
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64/10（CGNAT）
  if (a === 169 && b === 254) return true // 169.254/16（link-local + 云元数据）
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
  if (a === 192 && b === 168) return true // 192.168/16
  if (a === 192 && b === 0 && c === 0) return true // 192.0.0/24
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18/15（benchmark）
  if (a >= 224) return true // 组播 + 保留
  return false
}
