import { JumpServerError } from './types.js'
import type { KokoEndpoint } from './types.js'

/**
 * Match Core `handle_endpoint_host`: empty Default host becomes the Core URL host.
 * A configured endpoint host is left unchanged.
 */
export function resolveKokoEndpoint(endpoint: KokoEndpoint, coreBaseUrl: string): KokoEndpoint {
  const host = endpoint.host.trim()
  if (host) return { host, port: endpoint.port }
  const fallback = hostnameFromUrl(coreBaseUrl)
  if (!fallback) {
    throw new JumpServerError('KoKo endpoint host is empty and JUMPSERVER_URL has no hostname')
  }
  return { host: fallback, port: endpoint.port }
}

/** Hostname only, matching Core stripping the port from request.get_host(). */
export function hostnameFromUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname
  } catch {
    return ''
  }
}
