import { JumpServerError } from './types.js'
import type { ClientProtocolData, KokoEndpoint } from './types.js'
import { asRecord } from './normalize.js'

/**
 * Decode `GET /api/v1/authentication/connection-token/{id}/client-url/` into
 * host, port, and token fields used for KoKo SSH.
 */
export function parseClientUrlPayload(body: unknown): ClientProtocolData {
  const row = asRecord(body)
  const url = row.url
  if (typeof url !== 'string' || url.length === 0) {
    throw new JumpServerError('connection-token client-url response missing url', undefined, body)
  }
  return parseJmsUrl(url)
}

/** Decode a `jms://` deep link produced by JumpServer. */
export function parseJmsUrl(url: string): ClientProtocolData {
  const encoded = url.startsWith('jms://') ? url.slice('jms://'.length) : url
  let json: unknown
  try {
    json = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
  } catch (error) {
    throw new JumpServerError(`failed to decode jms:// client-url: ${String(error)}`)
  }
  const payload = asRecord(json)
  const tokenRow = payload.token !== undefined ? asRecord(payload.token) : payload
  const id = String(tokenRow.id ?? payload.id ?? '')
  const value = String(tokenRow.value ?? payload.value ?? '')
  if (!id || !value) {
    throw new JumpServerError('jms:// payload missing token id/value', undefined, json)
  }
  return {
    token: { id, value },
    endpoint: readEndpoint(payload),
    ...(typeof payload.protocol === 'string' ? { protocol: payload.protocol } : {}),
    ...(payload.asset !== undefined && payload.asset !== null && typeof payload.asset === 'object'
      ? { asset: asRecord(payload.asset) as ClientProtocolData['asset'] }
      : {}),
  }
}

function readEndpoint(payload: Record<string, unknown>): KokoEndpoint {
  const endpoint = payload.endpoint
  if (endpoint === undefined || endpoint === null || typeof endpoint !== 'object') {
    throw new JumpServerError('jms:// payload missing endpoint', undefined, payload)
  }
  const row = asRecord(endpoint)
  const host = String(row.host ?? '')
  const port = Number(row.port)
  if (!host || !Number.isFinite(port) || port <= 0) {
    throw new JumpServerError('jms:// payload has an invalid endpoint', undefined, payload)
  }
  return { host, port }
}
