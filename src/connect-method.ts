import { JumpServerError } from './types.js'

/** Native / KoKo methods JumpServer accepts for a given asset protocol. */
const NATIVE_CONNECT_METHODS: Record<string, readonly string[]> = {
  ssh: ['ssh_client', 'ssh_guide'],
  sftp: ['sftp_client'],
  telnet: ['ssh_client', 'ssh_guide'],
  mysql: ['web_cli'],
  mariadb: ['web_cli'],
  postgresql: ['web_cli'],
  postgres: ['web_cli'],
  oracle: ['web_cli'],
  sqlserver: ['web_cli'],
  mssql: ['web_cli'],
  clickhouse: ['web_cli'],
  db2: ['web_cli'],
  dameng: ['web_cli'],
  redis: ['web_cli'],
  mongodb: ['web_cli'],
  mongo: ['web_cli'],
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

const UNSUPPORTED_CONNECT_METHOD = /connect method not support|连接方式不支持/i

/** True when Core rejected the token's connect_method during client-url lookup. */
export function isUnsupportedConnectMethod(error: unknown): boolean {
  if (!(error instanceof JumpServerError)) return false
  if (error.status !== 400) return false
  return collectErrorTexts(error).some(text => UNSUPPORTED_CONNECT_METHOD.test(text))
}

function collectErrorTexts(error: JumpServerError): string[] {
  const texts = [error.message]
  if (error.body !== null && typeof error.body === 'object' && !Array.isArray(error.body)) {
    const row = error.body as Record<string, unknown>
    for (const key of ['detail', 'error', 'msg'] as const) {
      const value = row[key]
      if (typeof value === 'string' && value.length > 0) texts.push(value)
    }
  } else if (typeof error.body === 'string' && error.body.length > 0) {
    texts.push(error.body)
  }
  return texts
}
