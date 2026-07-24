/**
 * Prompt Service 层 — 内部类型
 *
 * 为什么需要这个文件？
 * shared/types/prompt.ts 是前后端共享类型（API 契约），
 * 但 Service 层内部有些参数视角不同。
 *
 * 当前 Service 的输入/输出与 shared/types 完全对齐，
 * 此文件仅做 re-export，预留扩展空间（如分页参数、内部标记等）。
 */
export type {
  PromptListItem,
  PromptDetail,
  PromptInput
} from '~~/shared/types/prompt'
