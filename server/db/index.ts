import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import * as schema from './schema'


const sql = neon(useRuntimeConfig().databaseUrl)
export const db = drizzle(sql, { schema })

export type DbClient = typeof db
