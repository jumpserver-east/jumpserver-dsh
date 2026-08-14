/** Asset protocols KoKo can open as a database session (usql / Redis / Mongo). */
export const DATABASE_PROTOCOLS = [
  'mysql',
  'mariadb',
  'postgresql',
  'oracle',
  'sqlserver',
  'clickhouse',
  'db2',
  'dameng',
  'redis',
  'mongodb',
] as const

const DATABASE_PROTOCOL_SET = new Set<string>(DATABASE_PROTOCOLS)

const PROTOCOL_ALIASES: Record<string, string> = {
  mssql: 'sqlserver',
  postgres: 'postgresql',
  mongo: 'mongodb',
}

/** Map user/asset aliases onto JumpServer protocol names (`mssql` → `sqlserver`). */
export function canonicalProtocol(protocol: string): string {
  const key = protocol.trim().toLowerCase()
  return PROTOCOL_ALIASES[key] ?? key
}

/** True when the asset protocol is a database, not SSH/SFTP. */
export function isDatabaseProtocol(protocol: string): boolean {
  return DATABASE_PROTOCOL_SET.has(canonicalProtocol(protocol))
}

/** Protocol names from a JumpServer asset `protocols` field. */
export function protocolNames(protocols: unknown): string[] {
  if (!Array.isArray(protocols)) return []
  const names: string[] = []
  for (const item of protocols) {
    if (typeof item === 'string' && item.trim()) {
      names.push(canonicalProtocol(item))
      continue
    }
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const name = (item as { name?: unknown }).name
      if (typeof name === 'string' && name.trim()) names.push(canonicalProtocol(name))
    }
  }
  return names
}

/**
 * Prefer an explicit protocol. Otherwise pick a database protocol from the
 * asset, then ssh, then the first listed protocol.
 */
export function pickAssetProtocol(protocols: unknown, requested?: string): string {
  return pickConnectProtocol({ protocols }, requested)
}

/**
 * Choose the token protocol. Uses asset `type` / `category` when `protocols`
 * is empty or uses an alias such as `mssql`.
 */
export function pickConnectProtocol(
  asset: { protocols?: unknown; type?: string; category?: string },
  requested?: string,
): string {
  if (requested?.trim()) return canonicalProtocol(requested)
  const names = protocolNames(asset.protocols)
  const type = asset.type ? canonicalProtocol(asset.type) : ''
  if (type && isDatabaseProtocol(type)) return type
  const database = names.find(isDatabaseProtocol)
  if (database) return database
  if (asset.category?.toLowerCase() === 'database') {
    return type || names[0] || 'mysql'
  }
  return names.find(name => name === 'ssh') ?? names[0] ?? 'ssh'
}
