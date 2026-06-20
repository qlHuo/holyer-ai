import type { Message } from '#shared/types/provider'

export function extractSystemPrompt(messages: Message[], explicitPrompt?: string): string | undefined {
  const systemFromMessages = messages
    .filter(m => m.role === 'system')
    .map(m => m.content)
    .join('\n\n')

  return [explicitPrompt, systemFromMessages]
    .filter(Boolean)
    .join('\n\n') || undefined
}
