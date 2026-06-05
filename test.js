async function chat() {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      message: [{ role: 'user', content: '第一步可以做什么？' }]
    })
  })

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    console.log(dec.decode(value, { stream: true }))
  }
}
chat()

async function getConversationsById() {
  const res = await fetch('/api/conversations/840a1615-95ba-475b-8675-4f7f765abceb', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  })

  const data = await res.json()
  console.log('getConversationsById', data)
}
getConversationsById()

async function getConversationsList() {
  const res = await fetch('/api/conversations', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  })

  const data = await res.json()
  console.log('getConversationsById', data)
}
getConversationsList()
