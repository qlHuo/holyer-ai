import { createLLMProvider } from '~~/server/service/llm/factory'
import { createSSEResponse } from '~~/server/utils/sse'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const {
    provider,
    model,
    message,
    tools,
    systemPrompt,
    temperature,
    maxTokens
  } = body

  if (!provider || !model || !message?.length) {
    throw createError({
      status: 400,
      message: '缺少必要参数：provider, model, messages'
    })
  }

  const llmProvider = createLLMProvider(provider)
  // Provider.chat() 返回 ReadableStream<string>（纯文本 token 流）
  const llmStream = await llmProvider.chat(message, {
    model,
    tools,
    systemPrompt,
    temperature,
    maxTokens
  })
  // 包装为 SSE Response → 浏览器逐 token 消费
  return createSSEResponse(llmStream, event)
})
