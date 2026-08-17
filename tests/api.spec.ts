import { describe, expect, it } from 'vitest'
import { JumpServerApi } from '../src/api.js'
import { JumpServerClient } from '../src/client.js'

function apiWith(handler: (url: string, init: RequestInit) => Response): JumpServerApi {
  const client = new JumpServerClient({
    baseUrl: 'https://jms.example.com',
    orgId: 'org',
    tlsRejectUnauthorized: true,
    auth: async () => ({ accessKeyId: 'kid', accessKeySecret: 'secret' }),
    fetchImpl: async (url, init) => handler(url, init),
  })
  return new JumpServerApi(client)
}

describe('createConnectionToken', () => {
  it('accepts a create response that omits value', async () => {
    const api = apiWith(() => new Response(JSON.stringify({ id: 'tok-1', protocol: 'ssh' }), { status: 201 }))
    await expect(api.createConnectionToken({
      asset: 'asset-1',
      account: 'root',
      protocol: 'ssh',
      connectMethod: 'ssh_client',
    })).resolves.toMatchObject({ id: 'tok-1', protocol: 'ssh' })
  })
})

describe('listAccounts', () => {
  it('reads permed_accounts from the user asset detail', async () => {
    const seen: string[] = []
    const api = apiWith((url) => {
      seen.push(url)
      if (url.includes('/perms/users/self/assets/asset-1/') && !url.includes('/accounts/')) {
        return new Response(JSON.stringify({
          id: 'asset-1',
          name: 'jumpserver-v4',
          address: '10.0.0.8',
          permed_accounts: [
            { id: '80f9752d-a628-4ac0-8e1f-c418bc7c0568', name: 'root', username: 'root', alias: 'root' },
            { id: '@USER', name: '@USER', username: '@USER', alias: '@USER' },
          ],
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ detail: 'no permission' }), { status: 403 })
    })
    await expect(api.listAccounts('asset-1')).resolves.toEqual({
      count: 2,
      results: [
        { id: '80f9752d-a628-4ac0-8e1f-c418bc7c0568', name: 'root', username: 'root', alias: 'root' },
        { id: '@USER', name: '@USER', username: '@USER', alias: '@USER' },
      ],
    })
    expect(seen.some(url => url.includes('/accounts/accounts/'))).toBe(false)
  })

  it('does not fall through to the admin accounts API when permed_accounts is empty', async () => {
    const api = apiWith((url) => {
      if (url.includes('/perms/users/self/assets/asset-1/') && !url.includes('/accounts/')) {
        return new Response(JSON.stringify({
          id: 'asset-1',
          name: 'jumpserver-v4',
          address: '10.0.0.8',
          permed_accounts: [],
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ detail: 'no permission' }), { status: 403 })
    })
    await expect(api.listAccounts('asset-1')).resolves.toEqual({ count: 0, results: [] })
  })

  it('uses the later /accounts/ subpath when the asset detail has no permed_accounts', async () => {
    const api = apiWith((url) => {
      if (url.includes('/assets/asset-1/accounts/')) {
        return new Response(JSON.stringify([
          { id: 'acc-1', username: 'root' },
        ]), { status: 200 })
      }
      if (url.includes('/perms/users/self/assets/asset-1/')) {
        return new Response(JSON.stringify({ id: 'asset-1', name: 'web' }), { status: 200 })
      }
      return new Response(JSON.stringify({ detail: 'no permission' }), { status: 403 })
    })
    await expect(api.listAccounts('asset-1')).resolves.toEqual({
      count: 1,
      results: [{ id: 'acc-1', username: 'root' }],
    })
  })

  it('explains the 403 instead of treating the admin accounts API as the user path', async () => {
    const api = apiWith(() => new Response(JSON.stringify({ detail: 'no permission' }), { status: 403 }))
    await expect(api.listAccounts('asset-1')).rejects.toThrow(/permed_accounts/)
  })
})

describe('resolveAccount', () => {
  it('does not list accounts for a UUID, even if listing would 403', async () => {
    const seen: string[] = []
    const api = apiWith((url) => {
      seen.push(url)
      return new Response(JSON.stringify({ detail: 'no permission' }), { status: 403 })
    })
    await expect(api.resolveAccount('asset-1', '80f9752d-a628-4ac0-8e1f-c418bc7c0568'))
      .resolves.toEqual({
        account: '80f9752d-a628-4ac0-8e1f-c418bc7c0568',
        inputUsernameRequired: false,
      })
    expect(seen).toEqual([])
  })

  it('does not list accounts for @USER', async () => {
    const seen: string[] = []
    const api = apiWith((url) => {
      seen.push(url)
      return new Response('[]', { status: 200 })
    })
    await expect(api.resolveAccount('asset-1', '@USER'))
      .resolves.toEqual({ account: '@USER', inputUsernameRequired: true })
    expect(seen).toEqual([])
  })

  it('lists accounts when resolving a display name', async () => {
    const api = apiWith((url) => {
      if (url.includes('/perms/users/self/assets/')) {
        return new Response(JSON.stringify({
          count: 1,
          results: [{ id: '80f9752d-a628-4ac0-8e1f-c418bc7c0568', name: 'TimePassBy', username: 'root' }],
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ detail: 'nope' }), { status: 403 })
    })
    await expect(api.resolveAccount('asset-1', 'TimePassBy'))
      .resolves.toEqual({
        account: '80f9752d-a628-4ac0-8e1f-c418bc7c0568',
        inputUsernameRequired: false,
      })
  })
})

function encodeJms(payload: unknown): string {
  return `jms://${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')}`
}

describe('createClientProtocol', () => {
  it('uses the create-token value when jms:// omits value', async () => {
    const url = encodeJms({
      token: { id: 'tok-1' },
      endpoint: { host: 'koko.example.com', port: 2222 },
    })
    const api = apiWith((href) => {
      if (href.endsWith('/authentication/connection-token/')) {
        return new Response(JSON.stringify({ id: 'tok-1', value: 'from-create', protocol: 'ssh' }), { status: 201 })
      }
      if (href.includes('/client-url/')) {
        return new Response(JSON.stringify({ url }), { status: 200 })
      }
      return new Response('nope', { status: 404 })
    })
    const result = await api.createClientProtocol({
      asset: 'asset-1',
      account: 'root',
      protocol: 'ssh',
    })
    expect(result.client.token).toEqual({ id: 'tok-1', value: 'from-create' })
  })

  it('expires the first token when retrying ssh_guide', async () => {
    const calls: Array<{ method: string; url: string }> = []
    let posts = 0
    const url = encodeJms({
      token: { id: 'tok-2', value: 'secret' },
      endpoint: { host: 'koko.example.com', port: 2222 },
    })
    const api = apiWith((href, init) => {
      const method = (init.method ?? 'GET').toUpperCase()
      calls.push({ method, url: href })
      if (method === 'POST' && href.endsWith('/authentication/connection-token/')) {
        posts += 1
        return new Response(JSON.stringify({ id: `tok-${posts}`, protocol: 'ssh' }), { status: 201 })
      }
      if (href.includes('/tok-1/client-url/')) {
        return new Response(JSON.stringify({ error: 'Connect method not support: ssh_client' }), { status: 400 })
      }
      if (href.includes('/tok-2/client-url/')) {
        return new Response(JSON.stringify({ url }), { status: 200 })
      }
      if (method === 'PATCH' && href.includes('/tok-1/expire/')) {
        return new Response('', { status: 200 })
      }
      return new Response('nope', { status: 404 })
    })
    const result = await api.createClientProtocol({
      asset: 'asset-1',
      account: 'root',
      protocol: 'ssh',
    })
    expect(result.token.id).toBe('tok-2')
    expect(calls.some(call => call.method === 'PATCH' && call.url.includes('/tok-1/expire/'))).toBe(true)
  })

  it('uses web_cli for mysql and KoKo SSH without calling client-url when value is present', async () => {
    const methods: string[] = []
    const seen: string[] = []
    const api = apiWith((href, init) => {
      seen.push(href)
      const method = (init.method ?? 'GET').toUpperCase()
      if (method === 'POST' && href.endsWith('/authentication/connection-token/')) {
        const body = JSON.parse(String(init.body)) as { connect_method: string; protocol: string }
        methods.push(body.connect_method)
        expect(body.protocol).toBe('mysql')
        return new Response(JSON.stringify({ id: 'tok-db', value: 'secret', protocol: 'mysql' }), { status: 201 })
      }
      if (href.includes('/terminal/endpoints/')) {
        return new Response(JSON.stringify({
          count: 1,
          results: [{ host: 'koko.example.com', ssh_port: 2222 }],
        }), { status: 200 })
      }
      return new Response('nope', { status: 404 })
    })
    const result = await api.createClientProtocol({
      asset: 'db-1',
      account: 'app',
      protocol: 'mysql',
    })
    expect(methods[0]).toBe('web_cli')
    expect(seen.some(href => href.includes('/client-url/'))).toBe(false)
    expect(result.client.endpoint).toEqual({ host: 'koko.example.com', port: 2222 })
    expect(result.client.token).toEqual({ id: 'tok-db', value: 'secret' })
  })

  it('sends sqlserver to Core when the caller says mssql', async () => {
    let protocol = ''
    const api = apiWith((href, init) => {
      const method = (init.method ?? 'GET').toUpperCase()
      if (method === 'POST' && href.endsWith('/authentication/connection-token/')) {
        protocol = (JSON.parse(String(init.body)) as { protocol: string }).protocol
        return new Response(JSON.stringify({ id: 'tok-db', value: 'secret', protocol: 'sqlserver' }), { status: 201 })
      }
      if (href.includes('/terminal/endpoints/')) {
        return new Response(JSON.stringify({ results: [{ host: 'koko.example.com', ssh_port: 2222 }] }), { status: 200 })
      }
      return new Response('nope', { status: 404 })
    })
    const result = await api.createClientProtocol({
      asset: 'db-1',
      account: 'sa',
      protocol: 'mssql',
    })
    expect(protocol).toBe('sqlserver')
    expect(result.token.protocol).toBe('sqlserver')
  })
})

describe('resolveKokoSshEndpoint', () => {
  it('reads ssh_port from the endpoints list', async () => {
    const api = apiWith((href) => {
      if (href.includes('/terminal/endpoints/')) {
        return new Response(JSON.stringify({
          results: [{ host: '', ssh_port: 2222 }, { host: 'other', https_port: 443 }],
        }), { status: 200 })
      }
      return new Response('nope', { status: 404 })
    })
    await expect(api.resolveKokoSshEndpoint()).resolves.toEqual({ host: '', port: 2222 })
  })

  it('falls back to Core host port 2222 when the list is unavailable', async () => {
    const api = apiWith(() => new Response(JSON.stringify({ detail: 'no permission' }), { status: 403 }))
    await expect(api.resolveKokoSshEndpoint()).resolves.toEqual({ host: '', port: 2222 })
  })
})
