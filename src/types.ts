/** Failure talking to JumpServer Core or KoKo. */
export class JumpServerError extends Error {
  readonly status?: number
  readonly body?: unknown

  constructor(message: string, status?: number, body?: unknown) {
    super(message)
    this.name = 'JumpServerError'
    this.status = status
    this.body = body
  }
}

/** Credentials resolved for one Core API call. */
export type ResolvedAuth =
  | { mode: 'access-key'; accessKeyId: string; accessKeySecret: string }
  | { mode: 'private-token'; token: string }
  | { mode: 'bearer'; token: string }

/** One page of a JumpServer list endpoint. */
export interface ListPage<T> {
  count: number
  results: T[]
}

/** Normalized asset shown to the model. */
export interface AssetSummary {
  id: string
  name: string
  address: string
  type?: string
  category?: string
  is_active?: boolean
  comment?: string
  platform?: unknown
  protocols?: unknown
  nodes?: unknown
  org_name?: string
}

/** Normalized account shown to the model. */
export interface AccountSummary {
  id?: string
  name?: string
  username?: string
  secret_type?: string
  privileged?: boolean
  is_active?: boolean
}

/** Connection token fields needed to open KoKo SSH. */
export interface ConnectionTokenInfo {
  id: string
  value: string
  protocol: string
  asset?: string
  account?: string
  date_expired?: string
}

/** Endpoint extracted from a `jms://` client-url payload. */
export interface KokoEndpoint {
  host: string
  port: number
}

/** Decoded JumpServer client protocol payload. */
export interface ClientProtocolData {
  token: { id: string; value: string }
  endpoint: KokoEndpoint
  protocol?: string
  asset?: { id?: string; name?: string; address?: string }
}
