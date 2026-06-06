/**
 * @Description SSE 流式相应工具
 *
 * 把上游产出的 SSEChunk 事件流包装成功标准 SSE Response
 * 所有需要 SSE 的端点（api/chat、api/agent/run） 公用
 *
 * 职责（纯传输端，不关注业务语义）
 * 1. SSE 格式转换： SSEChunk -> "data: {json}\n\n"
 * 2. 每 30s 心跳，防止 Cloudflare 100s 空闲超时
 * 3. 客户端断开时清理资源
 * 4. 设置 SSE 所需要的响应头
 */

import type { H3Event } from 'h3'

/** SSE 事件的最小结构 */
export interface SSEChunk {
  type: string
  [key: string]: unknown
}

/**
 * 创建 SSE Response
 *
 * @param sourceStream  上游端点构建的事件流（SSEChunk 逐个入队）
 * @param event         H3事件对象，用于监听客户端断开
 * @return              Response(Content-Type: text/event-stream)
*/
export function createSSEResponse(sourceStream: ReadableStream<SSEChunk>, event: H3Event): Response {
  let isClosed = false

  // Nodejs 环境，监听客户端断开
  if (event.node?.req) {
    event.node.req.on('close', () => {
      isClosed = true
    })
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      // 每 30s 发送心跳，防止 Cloudflare 100s 空闲超时
      const heartbeat = setInterval(() => {
        if (isClosed) {
          clearInterval(heartbeat)
          return
        }
        controller.enqueue(encoder.encode('event: ping\ndata: {}\n\n'))
      }, 1000 * 30)

      try {
        const reader = sourceStream.getReader()

        while (true) {
          const { done, value } = await reader.read()
          if (done || isClosed) break

          // 构造标准的SSE格式：data: <json> \n\n
          const payload = JSON.stringify(value)
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
        }
      } catch (error) {
        const errorPayload = JSON.stringify({
          type: 'error',
          content: error instanceof Error ? error.message : 'Unknown error'
        })
        if (!isClosed) {
          controller.enqueue(encoder.encode(`data: ${errorPayload}\n\n`))
        }
      } finally {
        clearInterval(heartbeat)
        controller.close()
      }
    },

    cancel() {
      // 流被取消时标记关闭
      isClosed = true
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  })
}
