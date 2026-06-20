/**
   * 从 SSE 帧中提取指定字段的值
   *
   * SSE 帧格式示例：
   *   event: text
   *   data: {"type":"text","content":"hello"}
   *
   * @param frame 完整的 SSE 帧（可能跨多行）
   * @param fieldName 字段名，如 'event'、'data'
   * @returns 字段值，未找到时返回 null
   */
export function extractSSEField(frame: string, fieldName: string): string | null {
  const prefix = `${fieldName}:`
  for (const line of frame.split('\n')) {
    if (line.startsWith(prefix)) {
      return line.slice(prefix.length).trim()
    }
  }
  return null
}
