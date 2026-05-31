import { db } from '~~/server/db'
import { conversations } from '~~/server/db/schema'
import { count } from 'drizzle-orm'

export default defineEventHandler(async () => {
  const res = await db.select().from(conversations)
  console.log('Conversations count:', res)
  const result = await db.select({ count: count() }).from(conversations)
  return { ok: true, conversationsCount: result?.[0]?.count, data: res }
})
