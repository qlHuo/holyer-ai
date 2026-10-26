/// <reference types="node" />

/**
 * 造假数据：一条带高德 schema 工具结果的历史对话（仅用于 UI 测试）
 *
 * 跑法（项目根目录）：
 *   npx tsx scripts/seed-fake-amap-chat.ts          # 插入测试对话
 *   npx tsx scripts/seed-fake-amap-chat.ts --clean  # 删除所有测试对话（级联删消息）
 *
 * 目的：不调用高德 MCP、不依赖模型，直接验证「工具卡片 → 唤端按钮」的渲染链路。
 * 插入后打开 http://localhost:3000/ ，在左侧列表点击「[测试] 高德唤端按钮」。
 *
 * 数据形状与后端落库一致：
 *   assistant(tool_calls) → tool(result) → assistant(text)
 */

import postgres from 'postgres'

process.loadEnvFile('.env')

const TITLE = '[测试] 高德唤端按钮'
const DB_URL = process.env.NUXT_DATABASE_URL
if (!DB_URL) throw new Error('缺少 NUXT_DATABASE_URL')

const sql = postgres(DB_URL, { connect_timeout: 5, idle_timeout: 5 })

if (process.argv.includes('--clean')) {
  const deleted = await sql`delete from conversations where title = ${TITLE} returning id`
  console.log(`已清理 ${deleted.length} 个测试对话`)
  await sql.end()
  process.exit(0)
}

const [conv] = await sql`
  insert into conversations (title, model)
  values (${TITLE}, ${'deepseek-v4-pro'})
  returning id
`
if (!conv) throw new Error('创建测试对话失败')

const now = Date.now()
const at = (offset: number) => new Date(now + offset)

await sql`
  insert into messages (conversation_id, role, content, created_at)
  values (${conv.id}, 'user', ${'导航到杭州西湖'}, ${at(0)})
`

await sql`
  insert into messages (conversation_id, role, content, tool_calls, created_at)
  values (
    ${conv.id},
    'assistant',
    '',
    ${sql.json([{
      id: 'call_fake_amap',
      name: 'gaode__maps_schema_navi',
      arguments: JSON.stringify({ lon: '120.1551', lat: '30.2741' })
    }])},
    ${at(1)}
  )
`

await sql`
  insert into messages (conversation_id, role, content, tool_call_id, created_at)
  values (
    ${conv.id},
    'tool',
    ${'https://uri.amap.com/marker?position=120.1551,30.2741&name=%E8%A5%BF%E6%B9%96&coordinate=gaode&callnative=0'},
    ${'call_fake_amap'},
    ${at(2)}
  )
`

await sql`
  insert into messages (conversation_id, role, content, created_at)
  values (${conv.id}, 'assistant', ${'已生成导航链接，点击上方按钮打开高德地图。'}, ${at(3)})
`

console.log(`已创建测试对话：${conv.id}`)
console.log(`打开 http://localhost:3000/ ，在左侧列表点击「${TITLE}」`)
console.log('清理：npx tsx scripts/seed-fake-amap-chat.ts --clean')

await sql.end()
