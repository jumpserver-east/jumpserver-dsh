import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'

/** Pretty-print a canonical JSON tool result for the model. */
export function renderJson(_args: unknown, value: JsonValue): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

/** Shared output schema for structured JSON payloads. */
export const jsonOutput = {
  schema: { type: 'json' as const },
  render: renderJson,
}
