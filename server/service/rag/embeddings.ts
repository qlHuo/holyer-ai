/**
 * embeddings — 文本 → 向量
 *
 * 调 qwen3.7-text-embedding（OpenAI 兼容接口），输出 1024 维向量。
 * - 维度锁定 1024：改 = 重建全库（见 embedding-dimensions 笔记）
 * - 纯函数、零 Nitro 依赖：配置通过参数传入——
 *   灌库脚本读 .env、运行时工具读 useRuntimeConfig，二者复用同一套逻辑
 */

/** 维度锁定 1024，不可改（改 = 全库重建） */
export const EMBEDDING_DIMENSIONS = 1024
/** embedding 模型，写入 chunks.embedding_model 列 */
export const EMBEDDING_MODEL = 'qwen3.7-text-embedding'

/** 调用方传入的凭据（模型名和维度已锁定为常量，不在此配置） */
export interface EmbeddingConfig {
  embeddingApiKey: string
  embeddingBaseUrl: string // 形如 https://dashscope.aliyuncs.com/compatible-mode/v1，结尾不带 /
}

interface EmbeddingsResponse {
  data: { index: number, embedding: number[] }[]
}

/**
 * 批量文本 → 向量数组（返回顺序与输入一致）
 * 传入多少条就一次请求多少条，批量切分策略由调用方决定（灌库脚本按批调用）。
 */
export async function embedTexts(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
  if (texts.length === 0) return []

  const res = await fetch(`${config.embeddingBaseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.embeddingApiKey}`
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS // 显式锁定维度，防默认值漂移
    })
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`embedding 请求失败：HTTP ${res.status} ${errText.slice(0, 300)}`)
  }

  const json = await res.json() as EmbeddingsResponse
  // 按 index 排序，保证返回顺序与输入一致（某些实现可能乱序返回）
  return json.data
    .sort((a, b) => a.index - b.index)
    .map(d => d.embedding)
}

/** 单条文本 → 向量（检索时给 query 用） */
export async function embedText(text: string, config: EmbeddingConfig): Promise<number[]> {
  const [vec] = await embedTexts([text], config)
  if (!vec) throw new Error('embedding 返回为空')
  return vec
}
