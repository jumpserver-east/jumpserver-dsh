import { describe, expect, it } from 'vitest'
import { formatNetworkError } from '../src/errors.js'
import { JumpServerClient } from '../src/client.js'
import { JumpServerError } from '../src/types.js'

describe('formatNetworkError', () => {
  it('includes the TLS or errno code from cause', () => {
    const error = new TypeError('fetch failed')
    Object.assign(error, { cause: Object.assign(new Error('unable to verify'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }) })
    expect(formatNetworkError(error)).toContain('UNABLE_TO_VERIFY_LEAF_SIGNATURE')
    expect(formatNetworkError(error)).toContain('fetch failed')
  })
})

describe('JumpServerClient network errors', () => {
  it('wraps fetch failures with the cause code', async () => {
    const failure = new TypeError('fetch failed')
    Object.assign(failure, { cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }) })
    const client = new JumpServerClient({
      baseUrl: 'https://jms.example.com',
      orgId: 'org',
      tlsRejectUnauthorized: true,
      auth: async () => ({ accessKeyId: 'kid', accessKeySecret: 'secret' }),
      fetchImpl: async () => {
        throw failure
      },
    })
    await expect(client.get('/api/v1/users/profile/')).rejects.toMatchObject({
      name: 'JumpServerError',
      message: expect.stringContaining('ECONNREFUSED'),
    })
    await expect(client.get('/api/v1/users/profile/')).rejects.toBeInstanceOf(JumpServerError)
  })
})
