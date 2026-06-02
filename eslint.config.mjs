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
