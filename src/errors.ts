/** Flatten a fetch/ssh2 failure so the tool result shows the OS/TLS code. */
export function formatNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const parts = [error.message]
  const cause = (error as Error & { cause?: unknown }).cause
  if (cause instanceof Error) {
    const code = 'code' in cause && typeof cause.code === 'string' ? cause.code : undefined
    if (code && !parts.includes(code)) parts.push(code)
    if (cause.message && !parts.includes(cause.message)) parts.push(cause.message)
  } else if (cause && typeof cause === 'object' && cause !== null && 'code' in cause) {
    const code = (cause as { code: unknown }).code
    if (typeof code === 'string' && !parts.includes(code)) parts.push(code)
  }
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
  if (code && !parts.includes(code)) parts.push(code)
  return parts.join(': ')
}
