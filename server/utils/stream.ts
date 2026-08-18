/**
 * LLM 输出流过滤器
 * 【说明】当前无调用者，保留作零工具模式适配器
*/

import type { LLMStreamChunk } from '~~/shared/types/provider'

export function filterTextChunks(source: ReadableStream<LLMStreamChunk>): ReadableStream<string> {
  return new ReadableStream({
    async start(controller) {
      const reader = source.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value.type === 'text') {
            controller.enqueue(value.content)
          }
        }
        controller.close()
      } catch (e) {
        controller.error(e)
      }
    }
  })
}
