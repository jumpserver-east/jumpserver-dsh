import { describe, expect, it } from 'vitest'
import { JumpServerClient, buildRequestUrl, signingPath } from '../src/client.js'
import { JumpServerError } from '../src/types.js'

describe('buildRequestUrl', () => {
  it('joins base URL and path and omits empty query values', () => {
    const url = buildRequestUrl('https://jms.example.com/', '/api/v1/perms/users/self/assets/', {
      search: 'web',
      offset: 0,
      empty: '',
      skip: undefined,
    })
    expect(url.toString()).toBe('https://jms.example.com/api/v1/perms/users/self/assets/?search=web&offset=0')
    expect(signingPath(url)).toBe('/api/v1/perms/users/self/assets/?search=web&offset=0')
  })
})

describe('JumpServerClient', () => {
  it('signs GET requests and sends X-JMS-ORG', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = []
    const client = new JumpServerClient({
      baseUrl: 'https://jms.example.com',
      orgId: '00000000-0000-0000-0000-000000000002',
      tlsRejectUnauthorized: true,
      now: () => new Date('1994-11-15T08:12:31.000Z'),
      auth: async () => ({
        mode: 'access-key',
        accessKeyId: 'kid',
        accessKeySecret: 'secret',
      }),
      fetchImpl: async (url, init) => {
        seen.push({ url, init })
        return new Response(JSON.stringify({ username: 'admin' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    })

    const body = await client.get('/api/v1/users/profile/')
    expect(body).toEqual({ username: 'admin' })
    expect(seen).toHaveLength(1)
    const headers = new Headers(seen[0]!.init.headers)
    expect(headers.get('X-JMS-ORG')).toBe('00000000-0000-0000-0000-000000000002')
    expect(headers.get('Accept')).toBe('application/json')
    expect(headers.get('Date')).toBe('Tue, 15 Nov 1994 08:12:31 GMT')
    expect(headers.get('Authorization')).toMatch(/^Signature keyId="kid",algorithm="hmac-sha256"/)
  })

  it('uses Token authorization for private-token mode', async () => {
    let authorization = ''
    const client = new JumpServerClient({
      baseUrl: 'https://jms.example.com',
      orgId: 'org',
      tlsRejectUnauthorized: true,
      auth: async () => ({ mode: 'private-token', token: 'abc' }),
      fetchImpl: async (_url, init) => {
        authorization = new Headers(init.headers).get('Authorization') ?? ''
        return new Response('{}', { status: 200 })
      },
    })
    await client.get('/api/v1/users/profile/')
    expect(authorization).toBe('Token abc')
  })

  it('throws JumpServerError with status on 403', async () => {
    const client = new JumpServerClient({
      baseUrl: 'https://jms.example.com',
      orgId: 'org',
      tlsRejectUnauthorized: true,
      auth: async () => ({ mode: 'bearer', token: 't' }),
      fetchImpl: async () => new Response(JSON.stringify({ detail: 'no permission' }), { status: 403 }),
    })
    await expect(client.get('/api/v1/assets/hosts/')).rejects.toMatchObject({
      name: 'JumpServerError',
      status: 403,
    })
  })

  it('returns undefined from getOrUndefined on 404', async () => {
    const client = new JumpServerClient({
      baseUrl: 'https://jms.example.com',
      orgId: 'org',
      tlsRejectUnauthorized: true,
      auth: async () => ({ mode: 'bearer', token: 't' }),
      fetchImpl: async () => new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }),
    })
    await expect(client.getOrUndefined('/api/v1/missing/')).resolves.toBeUndefined()
  })
})

describe('JumpServerError', () => {
  it('preserves status and body', () => {
    const error = new JumpServerError('nope', 401, { detail: 'auth' })
    expect(error.status).toBe(401)
    expect(error.body).toEqual({ detail: 'auth' })
  })
})
