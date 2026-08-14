import { describe, expect, it } from 'vitest'
import { JumpServerApi } from '../src/api.js'
import { JumpServerClient } from '../src/client.js'

function apiWith(handler: (url: string) => Response): JumpServerApi {
  const client = new JumpServerClient({
    baseUrl: 'https://jms.example.com',
    orgId: 'org',
    tlsRejectUnauthorized: true,
    auth: async () => ({ accessKeyId: 'kid', accessKeySecret: 'secret' }),
    fetchImpl: async (url) => handler(url),
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
