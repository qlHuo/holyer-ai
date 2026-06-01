import { createLLMProvider } from '~~/server/service/llm/factory';

export default defineEventHandler(async () => {
  const provider = createLLMProvider('deepseek')

  const stream = await provider.chat(
    [{ role: 'user', content: '用一句话介绍你自己，帮我规划一下AI 学习路线' }],
    { model: 'deepseek-v4-flash' }
  )

  // 收集所有 token 拼接成完整文本
  const reader = stream.getReader()
  let result = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    result += value
  }

  return { ok: true, reply: result }

  // 获取模型列表
  // const models = await provider.models()
  // return { ok: true, models }
})
