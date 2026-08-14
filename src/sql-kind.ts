import { canonicalProtocol, isDatabaseProtocol } from './protocol.js'
import { JumpServerError } from './types.js'

/** Whether a statement only reads data, or changes it. */
export type SqlKind = 'query' | 'write'

const SQL_QUERY_HEADS = new Set([
  'select',
  'show',
  'describe',
  'desc',
  'explain',
  'with',
  'values',
  'table',
  'use',
  'begin',
  'start',
  'commit',
  'rollback',
  'savepoint',
  'release',
  'declare',
  'prepare',
  'deallocate',
  'pragma',
])

const SQL_WRITE_HEADS = new Set([
  'insert',
  'update',
  'delete',
  'replace',
  'merge',
  'upsert',
  'truncate',
  'alter',
  'drop',
  'create',
  'grant',
  'revoke',
  'rename',
  'call',
  'exec',
  'execute',
  'load',
  'copy',
  'import',
  'export',
  'vacuum',
  'optimize',
  'repair',
  'lock',
  'unlock',
  'kill',
  'flush',
  'reset',
  'purge',
  'analyze',
  'comment',
  'handler',
])

const REDIS_QUERY_HEADS = new Set([
  'get',
  'mget',
  'getrange',
  'strlen',
  'keys',
  'scan',
  'type',
  'ttl',
  'pttl',
  'exists',
  'info',
  'ping',
  'echo',
  'dbsize',
  'select',
  'auth',
  'hget',
  'hmget',
  'hgetall',
  'hkeys',
  'hvals',
  'hlen',
  'hexists',
  'hscan',
  'lindex',
  'llen',
  'lrange',
  'smembers',
  'sismember',
  'scard',
  'sscan',
  'sunion',
  'sinter',
  'sdiff',
  'zrange',
  'zrevrange',
  'zrangebyscore',
  'zcard',
  'zscore',
  'zrank',
  'zscan',
  'object',
  'memory',
  'slowlog',
  'client',
  'config',
  'command',
  'time',
  'lastsave',
  'role',
])

const MONGO_WRITE_RE = /\.(insert(?:one|many)?|update(?:one|many)?|delete(?:one|many)?|replaceone|findandmodify|findoneand(?:update|delete|replace)|bulkwrite|drop(?:database|index|indexes)?|create(?:index|indexes|collection)|renamecollection)\s*\(/i

/**
 * Classify SQL / Redis / Mongo text. Unknown verbs are writes (fail closed).
 * `WITH` is a query unless a write verb appears later in the statement.
 */
export function classifySql(sql: string, protocol = 'mysql'): SqlKind {
  const statements = splitStatements(stripComments(sql))
  if (statements.length === 0) {
    throw new JumpServerError('sql must be non-empty')
  }
  const kind = canonicalProtocol(protocol)
  return statements.some(statement => isWriteStatement(statement, kind)) ? 'write' : 'query'
}

/** Reject write SQL unless `writeAuthorized` is on. Host sessions are not checked. */
export function assertSqlAllowed(sql: string, protocol: string, writeAuthorized: boolean): void {
  if (!isDatabaseProtocol(protocol)) return
  if (classifySql(sql, protocol) === 'query') return
  if (writeAuthorized) return
  throw new JumpServerError(
    'database writes (INSERT/UPDATE/DELETE and other mutations) require authorization. Set JUMPSERVER_ENABLE_DB_WRITE=true.',
  )
}

function isWriteStatement(statement: string, protocol: string): boolean {
  if (protocol === 'redis') {
    const head = firstKeyword(statement)
    if (!head) return true
    return !REDIS_QUERY_HEADS.has(head)
  }
  if (protocol === 'mongodb' || protocol === 'mongo') {
    return MONGO_WRITE_RE.test(statement) || SQL_WRITE_HEADS.has(firstKeyword(statement) ?? '')
  }
  const head = firstKeyword(statement)
  if (!head) return true
  if (head === 'with') return containsWriteKeyword(statement)
  if (SQL_QUERY_HEADS.has(head)) return false
  return true
}

function containsWriteKeyword(statement: string): boolean {
  for (const token of statement.match(/[A-Za-z_]+/g) ?? []) {
    if (SQL_WRITE_HEADS.has(token.toLowerCase())) return true
  }
  return false
}

function firstKeyword(statement: string): string | undefined {
  const match = statement.match(/[A-Za-z_]+/)
  return match?.[0]?.toLowerCase()
}

function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/#[^\n]*/g, ' ')
}

function splitStatements(sql: string): string[] {
  return sql.split(';').map(part => part.trim()).filter(part => part.length > 0)
}
