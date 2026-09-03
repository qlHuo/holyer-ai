/**
 * 知识库检索工具 — search_knowledge_base
 *
 * 把 RAG 检索能力注册成 Agent 工具：LLM 判断需要查私有文档时调用本工具，
 * 工具内部完成 query 向量化 + pgvector 相似度检索，返回带来源的片段。
 * 这是「Agentic RAG」的关键——检索是工具，LLM 自主决定要不要查、查什么。
 *
 * 零侵入：只新增本文件 + tools/index.ts 里注册一行，runner/chat 端点/前端全不用改。
 */

import type { ExecutableTool, ToolPermission } from '../types'
import type { ToolDefinition } from '~~/shared/types/provider'
import { db } from '~~/server/db'
import { embedText } from '~~/server/service/rag/embeddings'
import { searchChunks } from '~~/server/service/rag/retriever'

export class KnowledgeBaseSearchTool implements ExecutableTool {
  readonly name = 'search_knowledge_base'
  readonly description = '在用户的知识库中检索信息。输入检索查询（自然语言问题或关键词），返回最相关的文档片段（带来源文档标题）。适用于查找用户私有文档、项目资料、笔记等知识库内容。当用户的问题涉及自己的文档、项目资料时，应调用本工具检索并基于结果回答，而不是凭记忆猜测。当问题涉及多个独立方面（如同时涉及架构、数据库、部署）时，可在一轮内并行调用本工具多次（通常 2~4 次即可），分别检索不同方面；检索到足够信息后就直接回答，不要反复搜索同一主题。'
  readonly permission: ToolPermission = 'readonly'
  readonly parameters: Record<string, any> = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '检索查询，建议用完整的自然语言问题，例如「为什么项目选择 Neon 数据库」'
      },
      kbId: {
        type: 'string',
        description: '可选，知识库 ID。不传则检索全部知识库'
      }
    },
    required: ['query']
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const query = String(args.query ?? '').trim()
    if (!query) return '错误：检索内容不能为空'

    try {
      // 1. 读取 embedding 配置（runtimeConfig，对应 NUXT_EMBEDDING_* 环境变量）
      const config = useRuntimeConfig()

      // 2. query 向量化
      const vec = await embedText(query, {
        embeddingApiKey: config.embeddingApiKey,
        embeddingBaseUrl: config.embeddingBaseUrl
      })

      // 3. 纯向量检索 top-5
      const kbId = args.kbId ? String(args.kbId) : undefined
      const results = await searchChunks(db, vec, { kbId, topK: 5 })

      if (results.length === 0) {
        return `未在知识库中找到与「${query}」相关的内容。`
      }

      // 4. 格式化结果（带来源，供 LLM 引用溯源）
      //    命中 chunk 的附图以 markdown 拼在片段后（仅绝对 http(s) URL；相对路径丢弃，防请求应用源）。
      //    这样结果文本经 TOOL_END 落库 + 进 memory：LLM 可见并可引用图片，前端也能从结果
      //    提取出本轮白名单（见 app/utils/allowedImages.ts）。
      return results
        .map((r, i) => {
          const imageLines = r.images
            .filter(img => /^https?:\/\//i.test(img.url))
            .map(img => `\n![${img.alt}](${img.url})`)
            .join('')
          return `${i + 1}. [来源：${r.documentTitle}]（相似度 ${r.score.toFixed(2)}）\n${r.content}${imageLines}`
        })
        .join('\n\n')
    } catch (err) {
      return `检索失败：${err instanceof Error ? err.message : '未知错误'}`
    }
  }

  toDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters
    }
  }
}

export const knowledgeBaseSearchTool = new KnowledgeBaseSearchTool()
