/**
 * @Description SSE 流式相应工具
 * 把Provider的ReadableStream<string> 包装成标准SSE格式的Response
 * /api/chat 和 /api/agent/run（Phase 2）共用这一套。
 *
 * 职责：
 * 1. 设置 SSE 响应头
 * 2. 每 30s 发送心跳，防止 Cloudflare 100s 空闲超时
 * 3. token → SSE data 行格式转换
 * 4. 客户端断开时清理资源
 */

import type { H3Event } from 'h3'

export function createSSEResponse(sourceStream: ReadableStream<string>, event: H3Event): Response {
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
          const payload = JSON.stringify({ type: 'text', content: value })
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
        }

        // 发送结束信号
        if (!isClosed) {
          controller.enqueue(encoder.encode('data: {"type": "done"}\n\n'))
        }
      } catch (error) {
        const errorPayload = JSON.stringify({
          type: 'error',
          content: error instanceof Error ? error.message : 'Unknown error'
        })
        controller.enqueue(encoder.encode(`data: ${errorPayload}\n\n`))
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
