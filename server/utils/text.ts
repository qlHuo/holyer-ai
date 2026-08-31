/**
 * 此为防御性修复，根因待线上复现确证
 *
 * 清洗即将写入 Postgres text/varchar 列的字符串。
 *
 * 为什么需要：LLM 输出 / 工具结果（网页、检索）可能携带 Postgres 拒绝存储的字符，
 * 导致 INSERT/UPDATE 抛 DrizzleQueryError（真正的错误被藏在 cause 里，message 只含 SQL + params）：
 * - NUL 字节（u+0000）与 C0 控制字符 -> Postgres 报 "invalid byte sequence for encoding UTF8"
 * - 孤立代理项（lone surrogate，U+D800~U+DFFF）-> 破坏 neon-http 的 JSON 请求体，报 HTTP 400（本地 postgres-js 走二进制协议，能混过去）
 *
 * 保留 \t \n \r（markdown 缩进 / 换行正常渲染），其余非法字符删除或替换为 U+FFFD。
 */
export function sanitizeDbText(input: string): string {
  return input
    // 孤立的高/低代理项 -> U+FFFD（合法代理对不动）
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�')
    // NUL + C0 控制字符（保留 \t \n \r）-> 直接删除
    .replace(/[\p{Cc}]/gu, c => (c === '\t' || c === '\n' || c === '\r' ? c : ''))
}
