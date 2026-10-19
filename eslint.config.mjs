// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  // TS/Vue 专属规则（需要 TS parser，不能应用于纯文本文件）
  {
    name: 'holyer-ai/typescript',
    files: ['**/*.ts', '**/*.tsx', '**/*.vue'],
    rules: {
      // TypeScript — type safety
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }]
    }
  },
  // Vue 专属规则
  {
    name: 'holyer-ai/vue',
    files: ['**/*.vue'],
    rules: {
      'vue/define-macros-order': ['error', {
        order: ['defineProps', 'defineEmits', 'defineSlots', 'defineModel', 'defineOptions']
      }],
      'vue/prefer-import-from-vue': 'error',
      'vue/no-deprecated-slot-attribute': 'error',
      'vue/no-unused-refs': 'error',
      'vue/require-default-prop': 'warn'
    }
  },
  // dayjs 统一入口：插件是全局副作用，业务代码不得绕过 wrapper 直接引入。
  // 客户端/共享层将来需要日期能力时，另建对应 wrapper 并扩展此规则范围。
  {
    name: 'holyer-ai/dayjs-imports',
    files: ['server/**/*.ts'],
    ignores: ['server/utils/dayjs.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: 'dayjs',
          message: '请从 server/utils/dayjs 导入（插件已统一注册）'
        }],
        patterns: [{
          group: ['dayjs/plugin/*', 'dayjs/locale/*'],
          message: 'dayjs 插件/语言包统一在 server/utils/dayjs 注册，不要在业务代码直接引入'
        }]
      }]
    }
  },
  // 全部文件适用的通用规则
  {
    name: 'holyer-ai/general',
    rules: {
      'no-console': 'warn',
      'prefer-const': 'error',
      'object-shorthand': ['error', 'always']
    }
  }
)
