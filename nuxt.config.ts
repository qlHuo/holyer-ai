// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@pinia/nuxt',
    '@vueuse/nuxt'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  // 声明服务端环境变量
  // 私有变量（仅服务端可访问，不会暴露给前端）
  runtimeConfig: {
    databaseUrl: '',
    openaiApiKey: '',
    openaiBaseUrl: '',
    anthropicApiKey: '',
    anthropicBaseUrl: '',
    deepseekApiKey: '',
    deepseekBaseUrl: ''
  },

  routeRules: {
    '/': { prerender: true }
  },

  compatibilityDate: '2025-01-15',

  // Nitro server bundle 默认 target es2019 不支持 top-level await，
  // 设为 es2022 以支持 server/db/index.ts 中的编译时双驱动分支
  nitro: {
    esbuild: {
      options: {
        target: 'es2022'
      }
    }
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs',
        semi: false,
        quotes: 'single',
        indent: 2,
        arrowParens: false,
        quoteProps: 'consistent-as-needed',
        blockSpacing: true
      },
      formatters: {
        css: true,
        html: true,
        // Markdown 默认关闭——Prettier 不理解 MDC 语法且会破坏表格排版
        markdown: false
      }
    }
  },

  // nitro: {
  //   devProxy: {
  //     // 当你请求 /api 时，Nitro 会自动转发到你的 Mock 地址，只在csr下生效
  //     "/api": {
  //       target: "http://127.0.0.1:4523/m1/8122291-7879433-default/api",
  //       changeOrigin: true,
  //     }
  //   },
  //   // 如果是线上环境，使用 routeRules 进行转发 (SSR 模式下非常强)，ssr和csr都生效
  //   routeRules: {
  //     '/api/**': { proxy: 'http://127.0.0.1:4523/m1/8122291-7879433-default/api/**' }
  //   }
  // },

  // 禁用 Google Fonts 远程拉取（国内网络不通），使用本地字体回退
  fonts: {
    provider: 'local'
  }
})
