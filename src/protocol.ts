/** Asset protocols KoKo can open as a database session (usql / Redis / Mongo). */
export const DATABASE_PROTOCOLS = [
  'mysql',
  'mariadb',
  'postgresql',
  'postgres',
  'oracle',
  'sqlserver',
  'clickhouse',
  'db2',
  'dameng',
  'redis',
  'mongodb',
  'mongo',
] as const

const DATABASE_PROTOCOL_SET = new Set<string>(DATABASE_PROTOCOLS)

/** True when the asset protocol is a database, not SSH/SFTP. */
export function isDatabaseProtocol(protocol: string): boolean {
  return DATABASE_PROTOCOL_SET.has(protocol.trim().toLowerCase())
}

/** Protocol names from a JumpServer asset `protocols` field. */
export function protocolNames(protocols: unknown): string[] {
  if (!Array.isArray(protocols)) return []
  const names: string[] = []
  for (const item of protocols) {
    if (typeof item === 'string' && item.trim()) {
      names.push(item.trim().toLowerCase())
      continue
    }
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const name = (item as { name?: unknown }).name
      if (typeof name === 'string' && name.trim()) names.push(name.trim().toLowerCase())
    }
  }
  return names
}

/**
 * Prefer an explicit protocol. Otherwise pick a database protocol from the
 * asset, then ssh, then the first listed protocol.
 */
export function pickAssetProtocol(protocols: unknown, requested?: string): string {
  const explicit = requested?.trim()
  if (explicit) return explicit.toLowerCase()
  const names = protocolNames(protocols)
  return names.find(isDatabaseProtocol) ?? names.find(name => name === 'ssh') ?? names[0] ?? 'ssh'
}
