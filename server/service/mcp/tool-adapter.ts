/**
 * MCP 工具适配 — ToolSnapshot → ExecutableTool
 *
 * 三件事：
 * 1. 命名空间：slug__tool，避免多 Server 重名
 * 2. JSON Schema 清洗：MCP 是完整 Schema，Provider 只支持子集
 * 3. 结果拍平：content[] → 模型可读文本
 */

import type { ToolDefinition } from '~~/shared/types/provider'
import type { ExecutableTool, ToolPermission } from '../agent/tools/types'
import type { McpClient } from './client'
import { McpToolError } from './errors'
import type { McpContent, McpServerConfig, McpToolSnapshot } from './types'

const MAX_TOOL_NAME_LENGTH = 64
const MAX_DESCRIPTION_LENGTH = 1024
const MAX_SCHEMA_DEPTH = 6
const MAX_SCHEMA_SIZE = 16_000
const MAX_RESULT_CHARS = 20_000

const ALLOWED_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean'])

/** 为一个 Server 的多个工具生成适配器；used 用于同请求内的名称冲突消解 */
export function createMcpTools(
  server: McpServerConfig,
  snapshots: McpToolSnapshot[],
  client: McpClient
): ExecutableTool[] {
  const used = new Set<string>()
  return snapshots.map(snapshot => createMcpTool(server, snapshot, client, used))
}

function createMcpTool(
  server: McpServerConfig,
  snapshot: McpToolSnapshot,
  client: McpClient,
  used: Set<string>
): ExecutableTool {
  const name = buildToolName(server, snapshot, used)
  const description = buildDescription(server, snapshot)
  const parameters = sanitizeInputSchema(snapshot.inputSchema)
  const { permission, cacheable } = resolvePermission(snapshot.annotations)

  return {
    name,
    description,
    permission,
    parameters,
    cacheable,
    toDefinition(): ToolDefinition {
      return { name, description, parameters }
    },
    async execute(args: Record<string, unknown>, signal?: AbortSignal) {
      const result = await client.callTool(snapshot.name, args, signal)
      const text = flattenContent(result.content)

      // 业务失败：抛给 runner 标记 success=false，同时把服务端文案回填给模型
      if (result.isError) {
        throw new McpToolError(text || 'MCP 工具执行失败')
      }
      return text || '[空结果]'
    }
  }
}

// ─────────────────────────────────────────────
// 命名
// ─────────────────────────────────────────────

function buildToolName(
  server: McpServerConfig,
  snapshot: McpToolSnapshot,
  used: Set<string>
): string {
  const slug = sanitizeName(server.slug).slice(0, 16) || 'mcp'
  const base = sanitizeName(snapshot.name).slice(0, 40) || 'tool'
  let name = `${slug}__${base}`

  if (used.has(name)) {
    const suffix = `_${hash4(`${server.slug}:${snapshot.name}`)}`
    name = `${name.slice(0, MAX_TOOL_NAME_LENGTH - suffix.length)}${suffix}`
  }

  const baseName = name
  let counter = 2
  while (used.has(name)) {
    const suffix = `_${counter++}`
    name = `${baseName.slice(0, MAX_TOOL_NAME_LENGTH - suffix.length)}${suffix}`
  }

  used.add(name)
  return name
}

function sanitizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_')
}

function hash4(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0').slice(0, 4)
}

function buildDescription(server: McpServerConfig, snapshot: McpToolSnapshot): string {
  const raw = snapshot.description?.trim() || snapshot.name
  return truncate(`[${server.name}] ${raw}`, MAX_DESCRIPTION_LENGTH)
}

function resolvePermission(
  annotations: Record<string, unknown> | undefined
): { permission: ToolPermission, cacheable: boolean } {
  if (annotations?.readOnlyHint === true) {
    return { permission: 'readonly', cacheable: true }
  }
  if (annotations?.destructiveHint === true) {
    return { permission: 'dangerous', cacheable: false }
  }
  return { permission: 'readwrite', cacheable: false }
}

// ─────────────────────────────────────────────
// JSON Schema 清洗
// ─────────────────────────────────────────────

/** 保证输出是 OpenAI function calling 可接受的 object schema */
export function sanitizeInputSchema(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) {
    return { type: 'object', properties: {} }
  }

  const sanitized = sanitizeSchemaNode(raw, raw, 0)
  const schema = isRecord(sanitized) && sanitized.type === 'object'
    ? sanitized
    : { type: 'object', properties: {} }

  if (JSON.stringify(schema).length > MAX_SCHEMA_SIZE) {
    return { type: 'object', properties: {} }
  }
  return schema
}

function sanitizeSchemaNode(
  node: unknown,
  root: Record<string, unknown>,
  depth: number
): Record<string, unknown> {
  if (!isRecord(node) || depth > MAX_SCHEMA_DEPTH) {
    return { type: 'string' }
  }

  // 本地 $ref 解析；解析失败降级为字符串
  if (isString(node.$ref)) {
    const resolved = resolveRef(node.$ref, root)
    return resolved ? sanitizeSchemaNode(resolved, root, depth + 1) : { type: 'string' }
  }

  // anyOf / oneOf：取第一个非 null 分支
  const union = Array.isArray(node.anyOf)
    ? node.anyOf
    : Array.isArray(node.oneOf) ? node.oneOf : null

  if (union) {
    const branch = union.find(item => !isNullType(item)) ?? union[0]
    return branch ? sanitizeSchemaNode(branch, root, depth + 1) : { type: 'string' }
  }

  // allOf：取第一个 object 分支
  if (Array.isArray(node.allOf)) {
    const branch = node.allOf.find(item => isRecord(item) && item.type === 'object')
    if (branch) return sanitizeSchemaNode(branch, root, depth + 1)
  }

  const type = normalizeType(node.type)
  const result: Record<string, unknown> = { type }

  if (isString(node.description)) {
    result.description = truncate(node.description, MAX_DESCRIPTION_LENGTH)
  }
  if (Array.isArray(node.enum)) {
    result.enum = node.enum.filter(value =>
      ['string', 'number', 'boolean'].includes(typeof value)
    )
  }
  if (node.default !== undefined) result.default = node.default
  if (isString(node.format)) result.format = node.format

  if (type === 'object') {
    const properties = isRecord(node.properties) ? node.properties : {}
    const sanitizedProperties: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(properties)) {
      sanitizedProperties[key] = sanitizeSchemaNode(value, root, depth + 1)
    }
    result.properties = sanitizedProperties

    const required = Array.isArray(node.required)
      ? node.required.filter((key): key is string => isString(key) && key in sanitizedProperties)
      : []
    if (required.length > 0) result.required = required

    if (typeof node.additionalProperties === 'boolean') {
      result.additionalProperties = node.additionalProperties
    }
  }

  if (type === 'array') {
    result.items = node.items
      ? sanitizeSchemaNode(node.items, root, depth + 1)
      : { type: 'string' }
  }

  return result
}

function normalizeType(value: unknown): string {
  if (isString(value) && ALLOWED_TYPES.has(value)) return value

  if (Array.isArray(value)) {
    const first = value.find(item => isString(item) && item !== 'null' && ALLOWED_TYPES.has(item))
    if (isString(first)) return first
  }
  return 'string'
}

function isNullType(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.type === 'null') return true
  return Array.isArray(value.type) && value.type.length > 0 && value.type.every(item => item === 'null')
}

function resolveRef(ref: string, root: Record<string, unknown>): unknown {
  if (!ref.startsWith('#/')) return undefined

  let current: unknown = root
  for (const segment of ref.slice(2).split('/')) {
    if (!isRecord(current)) return undefined
    const key = segment.replace(/~1/g, '/').replace(/~0/g, '~')
    current = current[key]
  }
  return current
}

// ─────────────────────────────────────────────
// 结果拍平
// ─────────────────────────────────────────────

function flattenContent(content: McpContent[]): string {
  const parts: string[] = []

  for (const raw of content) {
    const item: Record<string, unknown> = isRecord(raw) ? raw : {}
    const type = isString(item.type) ? item.type : 'unknown'

    if (type === 'text' && isString(item.text)) {
      parts.push(item.text)
      continue
    }

    if (type === 'image' || type === 'audio') {
      const mime = isString(item.mimeType) ? item.mimeType : type
      parts.push(`[${type === 'image' ? '图片' : '音频'}：${mime}，内容已省略]`)
      continue
    }

    if (type === 'resource') {
      const resource = isRecord(item.resource) ? item.resource : {}
      if (isString(resource.text)) parts.push(resource.text)
      else if (isString(resource.uri)) parts.push(`[资源：${resource.uri}]`)
      else parts.push('[资源内容已省略]')
      continue
    }

    parts.push(`[${type} 内容已省略]`)
  }

  const text = parts.join('\n').trim()
  return text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)}\n\n（结果过长，已截断）`
    : text
}

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}
