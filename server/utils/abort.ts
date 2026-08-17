/**
 * AbortSignal 合并工具
 *
 * 用途：工具执行层需要同时响应多个取消源（客户端断开 + Agent 120s 超时 + 工具自身超时），
 * 而 fetch 只接受单个 signal。手动实现而非 AbortSignal.any()，保证 Workers 兼容性。
 *
 * 注意：返回的 signal 无显式 cleanup。单次 HTTP 请求的生命周期短，监听器随 isolate 销毁，
 * 无需手动释放。
 */

/**
 * 合并多个 AbortSignal：任一信号触发即 abort 合并后的 signal
 */
export function mergeAbortSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const valid = signals.filter((s): s is AbortSignal => s != null)

  if (valid.length === 0) return new AbortController().signal
  if (valid.length === 1) return valid[0]!

  const controller = new AbortController()
  const onAbort = () => controller.abort()

  for (const s of valid) {
    if (s.aborted) {
      controller.abort()
      break
    }
    s.addEventListener('abort', onAbort, { once: true })
  }

  return controller.signal
}
