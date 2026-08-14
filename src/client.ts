import { httpDate, signAccessKey } from './auth.js'
import { JumpServerError, type ResolvedAuth } from './types.js'

/** Optional fetch used by tests. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

/** One Core API request. */
export interface ClientRequest {
  method: string
  path: string
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  signal?: AbortSignal
  /** HTTP statuses that return the parsed body instead of throwing. */
  allowStatuses?: readonly number[]
}

/** Construct a Core client. Auth and base URL are resolved per request so rotated keys apply immediately. */
export interface JumpServerClientOptions {
  baseUrl: string | (() => string)
  orgId: string | (() => string)
  auth: () => Promise<ResolvedAuth>
  tlsRejectUnauthorized: boolean
  fetchImpl?: FetchLike
  now?: () => Date
}

/**
 * Join Core base URL with an API path and query string.
 * The returned URL's pathname+search is what Access Key signatures sign.
 */
export function buildRequestUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): URL {
  const root = baseUrl.replace(/\/+$/, '')
  const rel = path.startsWith('/') ? path : `/${path}`
  const url = new URL(`${root}${rel}`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }
  return url
}

/** Path used as HTTP Signature `(request-target)` ??pathname plus query. */
export function signingPath(url: URL): string {
  return `${url.pathname}${url.search}`
}

/** JumpServer Core REST client. */
export class JumpServerClient {
  private readonly baseUrl: string | (() => string)
  private readonly orgId: string | (() => string)
  private readonly auth: () => Promise<ResolvedAuth>
  private readonly tlsRejectUnauthorized: boolean
  private readonly fetchImpl?: FetchLike
  private readonly now: () => Date
  private insecureFetch?: FetchLike

  constructor(options: JumpServerClientOptions) {
    this.baseUrl = options.baseUrl
    this.orgId = options.orgId
    this.auth = options.auth
    this.tlsRejectUnauthorized = options.tlsRejectUnauthorized
    this.fetchImpl = options.fetchImpl
    this.now = options.now ?? (() => new Date())
  }

  private resolveBaseUrl(): string {
    const value = typeof this.baseUrl === 'function' ? this.baseUrl() : this.baseUrl
    return value.replace(/\/+$/, '')
  }

  private resolveOrgId(): string {
    return typeof this.orgId === 'function' ? this.orgId() : this.orgId
  }

  /** Perform a JSON API call and throw on unexpected HTTP errors. */
  async request<T = unknown>(spec: ClientRequest): Promise<T> {
    const { status, body, path } = await this.requestRaw(spec)
    if (status === 204) return undefined as T
    const allowed = spec.allowStatuses ?? []
    if (status >= 400 && !allowed.includes(status)) {
      throw new JumpServerError(
        `JumpServer ${spec.method.toUpperCase()} ${path} failed (${status}): ${formatError(body, '')}`,
        status,
        body,
      )
    }
    return body as T
  }

  /** Perform a JSON API call and return status + body. */
  async requestRaw(spec: ClientRequest): Promise<{ status: number; body: unknown; path: string }> {
    const url = buildRequestUrl(this.resolveBaseUrl(), spec.path, spec.query)
    const method = spec.method.toUpperCase()
    const date = httpDate(this.now())
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Date: date,
      'X-JMS-ORG': this.resolveOrgId(),
      'User-Agent': requestUserAgent(),
    }
    let body: string | undefined
    if (spec.body !== undefined) {
      body = JSON.stringify(spec.body)
      headers['Content-Type'] = 'application/json'
    }

    const auth = await this.auth()
    headers.Authorization = authorizationHeader(auth, method, signingPath(url), {
      accept: 'application/json',
      date,
    })

    const fetchImpl = await this.fetcher()
    const response = await fetchImpl(url.toString(), {
      method,
      headers,
      body,
      signal: spec.signal,
    })

    const text = response.status === 204 ? '' : await response.text()
    return {
      status: response.status,
      body: text.length === 0 ? undefined : parseBody(text),
      path: signingPath(url),
    }
  }

  async get<T = unknown>(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.request<T>({ method: 'GET', path, query, signal })
  }

  async post<T = unknown>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    return this.request<T>({ method: 'POST', path, body, signal })
  }

  async patch<T = unknown>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    return this.request<T>({ method: 'PATCH', path, body, signal })
  }

  async delete(path: string, signal?: AbortSignal): Promise<void> {
    await this.request({ method: 'DELETE', path, signal })
  }

  /** GET that returns undefined on 404 instead of throwing. */
  async getOrUndefined<T = unknown>(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
    signal?: AbortSignal,
  ): Promise<T | undefined> {
    const { status, body, path: signedPath } = await this.requestRaw({ method: 'GET', path, query, signal })
    if (status === 404) return undefined
    if (status >= 400) {
      throw new JumpServerError(
        `JumpServer GET ${signedPath} failed (${status}): ${formatError(body, '')}`,
        status,
        body,
      )
    }
    return body as T
  }

  private async fetcher(): Promise<FetchLike> {
    if (this.fetchImpl) return this.fetchImpl
    if (this.tlsRejectUnauthorized) {
      return (url, init) => globalThis.fetch(url, init)
    }
    if (!this.insecureFetch) {
      this.insecureFetch = await createInsecureFetch()
    }
    return this.insecureFetch
  }
}

function authorizationHeader(
  auth: ResolvedAuth,
  method: string,
  path: string,
  signedHeaders: { accept: string; date: string },
): string {
  return signAccessKey({
    keyId: auth.accessKeyId,
    secret: auth.accessKeySecret,
    method,
    path,
    headers: signedHeaders,
  })
}

function parseBody(text: string): unknown {
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function formatError(parsed: unknown, text: string): string {
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const row = parsed as Record<string, unknown>
    if (typeof row.detail === 'string') return row.detail
    if (typeof row.error === 'string') return row.error
    if (typeof row.msg === 'string') return row.msg
    return JSON.stringify(parsed)
  }
  if (typeof parsed === 'string' && parsed.length > 0) return parsed
  return text || 'unknown error'
}

/** JumpServer maps User-Agent to windows/mac/linux when resolving connect methods. */
function requestUserAgent(): string {
  const platform = process.platform === 'darwin'
    ? 'Macintosh; Intel Mac OS X'
    : process.platform === 'win32'
      ? 'Windows NT 10.0'
      : 'Linux x86_64'
  return `dsh-jumpserver/0.1.0 (${platform})`
}

async function createInsecureFetch(): Promise<FetchLike> {
  const undici = await import('undici')
  const dispatcher = new undici.Agent({ connect: { rejectUnauthorized: false } })
  return (url, init) =>
    (undici.fetch as (input: string, init?: object) => Promise<Response>)(url, { ...init, dispatcher })
}
