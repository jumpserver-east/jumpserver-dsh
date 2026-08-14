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
})
