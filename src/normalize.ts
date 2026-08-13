import { JumpServerError } from './types.js'
import type { AccountSummary, AssetSummary, ListPage } from './types.js'

/** Pick a stable asset projection from a JumpServer payload. */
export function summarizeAsset(raw: unknown): AssetSummary {
  const row = asRecord(raw)
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    address: String(row.address ?? ''),
    ...optionalString(row, 'type'),
    ...optionalString(row, 'category'),
    ...optionalBoolean(row, 'is_active'),
    ...optionalString(row, 'comment'),
    ...optionalUnknown(row, 'platform'),
    ...optionalUnknown(row, 'protocols'),
    ...optionalUnknown(row, 'nodes'),
    ...optionalString(row, 'org_name'),
  }
}

/** Pick a stable account projection from a JumpServer payload. */
export function summarizeAccount(raw: unknown): AccountSummary {
  const row = asRecord(raw)
  const username = row.username ?? row.name
  return {
    ...optionalString(row, 'id'),
    ...optionalString(row, 'name'),
    ...(typeof username === 'string' ? { username } : {}),
    ...optionalString(row, 'secret_type'),
    ...optionalBoolean(row, 'privileged'),
    ...optionalBoolean(row, 'is_active'),
  }
}

/**
 * JumpServer list APIs return either a DRF page `{count, results}` or a bare array.
 */
export function unwrapList<T>(body: unknown, map: (item: unknown) => T): ListPage<T> {
  if (Array.isArray(body)) {
    return { count: body.length, results: body.map(map) }
  }
  const row = asRecord(body)
  if (Array.isArray(row.results)) {
    const results = row.results.map(map)
    const count = typeof row.count === 'number' ? row.count : results.length
    return { count, results }
  }
  throw new JumpServerError('JumpServer list response was neither a page nor an array', undefined, body)
}

/** Read a JSON-object payload or throw. */
export function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  throw new JumpServerError('expected a JSON object from JumpServer', undefined, value)
}

function optionalString(
  row: Record<string, unknown>,
  key: string,
): Record<string, never> | { [k: string]: string } {
  const value = row[key]
  if (typeof value !== 'string') return {}
  return { [key]: value }
}

function optionalBoolean(
  row: Record<string, unknown>,
  key: string,
): Record<string, never> | { [k: string]: boolean } {
  const value = row[key]
  if (typeof value !== 'boolean') return {}
  return { [key]: value }
}

function optionalUnknown(
  row: Record<string, unknown>,
  key: string,
): Record<string, never> | { [k: string]: unknown } {
  if (!(key in row)) return {}
  return { [key]: row[key] }
}
