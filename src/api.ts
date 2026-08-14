import { pickAccountRef, pickAccountRefDirect, type ResolvedAccountRef } from './account.js'
import { isUnsupportedConnectMethod, nativeConnectMethods } from './connect-method.js'
import { parseClientUrlPayload } from './jms-url.js'
import { asRecord, summarizeAccount, summarizeAsset, unwrapList } from './normalize.js'
import { JumpServerError, type AccountSummary, type AssetSummary, type ConnectionTokenInfo, type ListPage } from './types.js'
import type { JumpServerClient } from './client.js'
import type { ClientProtocolData } from './types.js'

/** Query for listing the current user's assets. */
export interface ListAssetsQuery {
  search?: string
  limit?: number
  offset?: number
  address?: string
  name?: string
  type?: string
}

/** Fields accepted when creating a host. */
export interface CreateHostInput {
  name: string
  address: string
  platform: number | string
  nodes: string[]
  comment?: string
  is_active?: boolean
  protocols?: Array<{ name: string; port: number }>
}

/** Domain operations over JumpServer Core. */
export class JumpServerApi {
  constructor(private readonly client: JumpServerClient) {}

  /** Current user profile ù?useful to verify auth and org. */
  async profile(signal?: AbortSignal): Promise<unknown> {
    return this.client.get('/api/v1/users/profile/', undefined, signal)
  }

  /** Assets the authenticated user is permitted to use. */
  async listAssets(query: ListAssetsQuery = {}, signal?: AbortSignal): Promise<ListPage<AssetSummary>> {
    const body = await this.client.get('/api/v1/perms/users/self/assets/', {
      search: query.search,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
      address: query.address,
      name: query.name,
      type: query.type,
    }, signal)
    return unwrapList(body, summarizeAsset)
  }

  /** One permitted asset, falling back to the admin asset endpoint. */
  async getAsset(assetId: string, signal?: AbortSignal): Promise<AssetSummary> {
    const permed = await this.client.getOrUndefined(
      `/api/v1/perms/users/self/assets/${assetId}/`,
      undefined,
      signal,
    )
    if (permed !== undefined && looksLikeAsset(permed)) {
      return summarizeAsset(permed)
    }
    const admin = await this.client.get(`/api/v1/assets/assets/${assetId}/`, undefined, signal)
    return summarizeAsset(admin)
  }

  /** Map a tool account argument to the id/username Core expects. */
  async resolveAccount(assetId: string, account: string, signal?: AbortSignal): Promise<ResolvedAccountRef> {
    const direct = pickAccountRefDirect(account)
    if (direct) return direct
    const page = await this.listAccounts(assetId, signal)
    return pickAccountRef(account, page.results)
  }

  /** Accounts the user may use on an asset. */
  async listAccounts(assetId: string, signal?: AbortSignal): Promise<ListPage<AccountSummary>> {
    const permed = await this.client.getOrUndefined(
      `/api/v1/perms/users/self/assets/${assetId}/accounts/`,
      undefined,
      signal,
    )
    if (permed !== undefined && isListPayload(permed)) {
      return unwrapList(permed, summarizeAccount)
    }
    const admin = await this.client.get('/api/v1/accounts/accounts/', { asset: assetId, limit: 100 }, signal)
    return unwrapList(admin, summarizeAccount)
  }

  /** Nodes the current user can see. */
  async listNodes(signal?: AbortSignal): Promise<ListPage<Record<string, unknown>>> {
    const permed = await this.client.getOrUndefined('/api/v1/perms/users/self/nodes/', undefined, signal)
    if (permed !== undefined && isListPayload(permed)) {
      return unwrapList(permed, asRecord)
    }
    const admin = await this.client.get('/api/v1/assets/nodes/', { limit: 100 }, signal)
    return unwrapList(admin, asRecord)
  }

  /** Host platforms (needed when creating assets). */
  async listPlatforms(signal?: AbortSignal): Promise<ListPage<Record<string, unknown>>> {
    const body = await this.client.get('/api/v1/assets/platforms/', { category: 'host', limit: 100 }, signal)
    return unwrapList(body, asRecord)
  }

  /** Create a host asset. Requires JumpServer asset admin permission. */
  async createHost(input: CreateHostInput, signal?: AbortSignal): Promise<unknown> {
    return this.client.post('/api/v1/assets/hosts/', {
      name: input.name,
      address: input.address,
      platform: typeof input.platform === 'number' ? { pk: input.platform } : input.platform,
      nodes: input.nodes.map(pk => ({ pk })),
      comment: input.comment ?? '',
      is_active: input.is_active ?? true,
      protocols: input.protocols ?? [
        { name: 'ssh', port: 22 },
        { name: 'sftp', port: 22 },
      ],
      labels: [],
      accounts: [],
    }, signal)
  }

  /** Patch a host asset. */
  async updateHost(hostId: string, patch: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    return this.client.patch(`/api/v1/assets/hosts/${hostId}/`, patch, signal)
  }

  /** Delete a host asset. */
  async deleteHost(hostId: string, signal?: AbortSignal): Promise<void> {
    await this.client.delete(`/api/v1/assets/hosts/${hostId}/`, signal)
  }

  /** Create a connection token for KoKo / other terminal components. */
  async createConnectionToken(input: {
    asset: string
    account: string
    protocol: string
    connectMethod: string
    inputUsername?: string
    reusable?: boolean
  }, signal?: AbortSignal): Promise<ConnectionTokenInfo> {
    const body = await this.client.post('/api/v1/authentication/connection-token/', {
      asset: input.asset,
      account: input.account,
      protocol: input.protocol,
      connect_method: input.connectMethod,
      ...(input.inputUsername ? { input_username: input.inputUsername } : {}),
      ...(input.reusable ? { is_reusable: true } : {}),
    }, signal)
    const row = asRecord(body)
    const id = String(row.id ?? '')
    if (!id) {
      throw new JumpServerError('connection-token response missing id', undefined, body)
    }
    const value = typeof row.value === 'string' && row.value.length > 0 ? row.value : undefined
    return {
      id,
      ...(value ? { value } : {}),
      protocol: String(row.protocol ?? input.protocol),
      ...(typeof row.asset === 'string' ? { asset: row.asset } : {}),
      ...(typeof row.account === 'string' ? { account: row.account } : {}),
      ...(typeof row.date_expired === 'string' ? { date_expired: row.date_expired } : {}),
    }
  }

  /** Decode the KoKo SSH endpoint for a connection token. */
  async getClientProtocol(
    tokenId: string,
    signal?: AbortSignal,
    fallback?: { id?: string; value?: string },
  ): Promise<ClientProtocolData> {
    const body = await this.client.get(
      `/api/v1/authentication/connection-token/${tokenId}/client-url/`,
      undefined,
      signal,
    )
    return parseClientUrlPayload(body, fallback)
  }

  /**
   * Create a token with a native KoKo connect_method and resolve client-url.
   * Retries ssh_guide if ssh_client is rejected.
   */
  async createClientProtocol(input: {
    asset: string
    account: string
    protocol: string
    inputUsername?: string
    reusable?: boolean
  }, signal?: AbortSignal): Promise<{ token: ConnectionTokenInfo; client: ClientProtocolData }> {
    const methods = nativeConnectMethods(input.protocol)
    let lastError: unknown
    for (const [index, connectMethod] of methods.entries()) {
      try {
        const token = await this.createConnectionToken({ ...input, connectMethod }, signal)
        const client = await this.getClientProtocol(token.id, signal, token)
        return { token, client }
      } catch (error) {
        lastError = error
        const canRetry = isUnsupportedConnectMethod(error) && index < methods.length - 1
        if (!canRetry) throw error
      }
    }
    throw lastError
  }
}

function looksLikeAsset(body: unknown): boolean {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false
  const row = body as Record<string, unknown>
  return typeof row.id === 'string' || typeof row.name === 'string'
}

function isListPayload(body: unknown): boolean {
  if (Array.isArray(body)) return true
  if (body === null || typeof body !== 'object') return false
  return Array.isArray((body as Record<string, unknown>).results)
}
