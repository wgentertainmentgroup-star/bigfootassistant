export const DEFAULT_ASSISTANT_NAME = 'Bubba'

export function cleanAssistantName(value: string | null | undefined) {
  const cleaned = String(value || '')
    .replace(/[^\p{L}\p{N}' -]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24)
    .trim()
  return cleaned || DEFAULT_ASSISTANT_NAME
}

export function assistantPossessive(value: string | null | undefined) {
  const name = cleanAssistantName(value)
  return /s$/i.test(name) ? `${name}’` : `${name}’s`
}

export function personalizeStarterGreeting(text: string, value: string | null | undefined) {
  if (!/^Hi\. I’m .{1,24}, your personal assistant\./.test(text)) return text
  return text.replace(/^Hi\. I’m .{1,24}, your personal assistant\./, `Hi. I’m ${cleanAssistantName(value)}, your personal assistant.`)
}
