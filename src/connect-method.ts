import { JumpServerError } from './types.js'

/** Native KoKo methods JumpServer accepts for a given asset protocol. */
const NATIVE_CONNECT_METHODS: Record<string, readonly string[]> = {
  ssh: ['ssh_client', 'ssh_guide'],
  sftp: ['sftp_client'],
  telnet: ['ssh_client', 'ssh_guide'],
}

const DEFAULT_CONNECT_METHODS = ['ssh_client', 'ssh_guide'] as const

/**
 * JumpServer connect_method is not the asset protocol.
 * `ssh` is a protocol; client-url only accepts `ssh_client` / `ssh_guide`.
 */
export function nativeConnectMethods(protocol: string): readonly string[] {
  const key = protocol.trim().toLowerCase()
  return NATIVE_CONNECT_METHODS[key] ?? DEFAULT_CONNECT_METHODS
}

/** True when Core rejected the token's connect_method during client-url lookup. */
export function isUnsupportedConnectMethod(error: unknown): boolean {
  if (!(error instanceof JumpServerError)) return false
  if (error.status !== 400) return false
  return /connect method not support/i.test(error.message)
}
