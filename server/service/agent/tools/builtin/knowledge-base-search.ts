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
import type { ToolContext, ToolDefinition } from '~~/shared/types/provider'
import type { CitationMeta } from '#shared/citation'
import { buildCitationTrailer, citationKey } from '#shared/citation'
import { db } from '~~/server/db'
import { embedText } from '~~/server/service/rag/embeddings'
import { hybridSearch } from '~~/server/service/rag/retriever'

export class KnowledgeBaseSearchTool implements ExecutableTool {
  readonly name = 'search_knowledge_base'
  readonly description = '在用户的知识库中检索信息。输入检索查询（自然语言问题或关键词），返回最相关的文档片段（带来源文档标题）。适用于查找用户私有文档、项目资料、笔记等知识库内容。当用户的问题涉及自己的文档、项目资料时，应调用本工具检索并基于结果回答，而不是凭记忆猜测。当问题涉及多个独立方面（如同时涉及架构、数据库、部署）时，可在一轮内并行调用本工具多次（通常 2~4 次即可），分别检索不同方面；检索到足够信息后就直接回答，不要反复搜索同一主题。'
    + '\n\n引用规范：每个片段以形如 [kb:3f9a2c1d4e5f] 的标识开头。当你使用了某个片段的信息时，请在该句末尾原样附上它的标识（如「……按标题语义分块 [kb:3f9a2c1d4e5f]」）；没用到的片段不要标注。若一句话综合了多个片段，可并列标注。'
    + '\n注意：不要自己编写「参考来源」「参考资料」列表——系统会自动附加；也不要输出或提及结果开头的 ⟦src…⟧ 内容（那是系统元数据）。'

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

  async execute(args: Record<string, unknown>, _signal?: AbortSignal, ctx?: ToolContext): Promise<string> {
    const query = String(args.query ?? '').trim()
    // ⚠️ 每条返回路径都必须带元数据块（哪怕是空数组）——「偏移 0 恒由工具自己写」
    // 是伪造元数据防线的前提，见 shared/citation.ts 文件头
    if (!query) return buildCitationTrailer([]) + '错误：检索内容不能为空'

    try {
      // 1. 读取 embedding 配置（runtimeConfig，对应 NUXT_EMBEDDING_* 环境变量）
      const config = useRuntimeConfig()

      // 2. query 向量化
      const vec = await embedText(query, {
        embeddingApiKey: config.embeddingApiKey,
        embeddingBaseUrl: config.embeddingBaseUrl
      })

      // 3. 混合检索（向量 + 全文 + RRF 融合）top-5
      //    检索范围三层决定：会话级 ctx.kbIds（用户「指定库」，装饰器强约束）> LLM 传的 args.kbId（自动模式）> 全库
      //    — 用户指定范围时，忽略 LLM 传的 kbId，从代码层面锁死，不依赖模型理解
      //    — 未指定（自动）才采纳 LLM 的 args.kbId，或无参全库检索
      const scopedKbIds = ctx?.kbIds?.length ? ctx.kbIds : undefined
      const toolKbId = !scopedKbIds && args.kbId ? String(args.kbId) : undefined
      const results = await hybridSearch(
        db,
        vec,
        query,
        scopedKbIds
          ? { kbIds: scopedKbIds, topK: 5 }
          : { ...(toolKbId ? { kbId: toolKbId } : {}), topK: 5 }
      )

      if (results.length === 0) {
        return buildCitationTrailer([]) + `未在知识库中找到与「${query}」相关的内容。`
      }

      // 4. 来源元数据（机器可读，供前端渲染 citation）+ 可读片段
      //    - 元数据块固定放最前面并参与本工具的**所有**返回路径（防伪造，见 shared/citation.ts）
      //    - 片段行首的 [kb:xxxx] 是稳定短 key（chunkId 前 8 位），LLM 引用时原样抄，
      //      前端据此把回答里的 [kb:xxxx] 换成可点击 chip
      //    - 来源标签取代数字分数：混合检索的 RRF 分量级约 0.02，直接展示「相似度 0.02」会被 LLM 误读为「不相关」
      //    - 命中 chunk 的附图以 markdown 拼在片段后（仅绝对 http(s) URL；相对路径丢弃，防请求应用源），
      //      前端从结果提取出本轮图片白名单（见 app/utils/allowedImages.ts）
      //      ⚠️ 图片 markdown 行不可改动格式
      const metas: CitationMeta[] = results.map(r => ({
        k: citationKey(r.chunkId),
        d: r.documentId,
        b: r.kbId,
        c: r.chunkIndex,
        u: r.sourceUrl,
        t: r.documentTitle,
        h: r.headingPath
      }))

      const body = results
        .map((r) => {
          const imageLines = r.images
            .filter(img => /^https?:\/\//i.test(img.url))
            .map(img => `\n![${img.alt}](${img.url})`)
            .join('')
          const sourceTag = r.source === 'keyword'
            ? '（关键词精确命中）'
            : r.source === 'both' ? '（关键词+语义）' : ''
          return `[kb:${citationKey(r.chunkId)}] [来源：${r.documentTitle}]${sourceTag}\n${r.content}${imageLines}`
        })
        .join('\n\n')

      return buildCitationTrailer(metas) + body
    } catch (err) {
      return buildCitationTrailer([]) + `检索失败：${err instanceof Error ? err.message : '未知错误'}`
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
