import * as schema from './schema'

const config = useRuntimeConfig()

// import.meta.dev 是编译时常量，Vite 在生产构建中剔除 dev 分支
// top-level await 需要 es2022 target（已在 nuxt.config.ts nitro.esbuild 配置）
const db = import.meta.dev
  ? await createDevDb(config.databaseUrl)
  : await createProdDb(config.databaseUrl)

async function createDevDb(url: string) {
  const { default: postgres } = await import('postgres')
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const sql = postgres(url, {
    max: 10, // 最大连接数
    idle_timeout: 30, // 空闲超时 (s)
    connect_timeout: 5 // 连接超时 (s)
  })
  return drizzle(sql, { schema })
}

async function createProdDb(url: string) {
  const { neon } = await import('@neondatabase/serverless')
  const { drizzle } = await import('drizzle-orm/neon-http')
  const sql = neon(url)
  return drizzle(sql, { schema })
}

export { db }
export type DbClient = typeof db
