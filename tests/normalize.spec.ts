import { describe, expect, it } from 'vitest'
import { unwrapList, summarizeAsset, summarizeAccount } from '../src/normalize.js'
import { parseJmsUrl } from '../src/jms-url.js'

describe('unwrapList', () => {
  it('accepts a DRF page', () => {
    const page = unwrapList({ count: 2, results: [{ id: 'a', name: 'one', address: '1.1.1.1' }] }, summarizeAsset)
    expect(page.count).toBe(2)
    expect(page.results[0]?.name).toBe('one')
  })

  it('accepts a bare array', () => {
    const page = unwrapList([{ id: 'a', username: 'root' }], summarizeAccount)
    expect(page.count).toBe(1)
    expect(page.results[0]?.username).toBe('root')
  })
})

describe('parseJmsUrl', () => {
  it('decodes endpoint and token from a jms:// payload', () => {
    const payload = {
      token: { id: 'tok-1', value: 'secret' },
      endpoint: { host: 'koko.example.com', port: 2222 },
      protocol: 'ssh',
      asset: { id: 'asset-1', name: 'web-1', address: '10.0.0.8' },
    }
    const encoded = `jms://${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')}`
    expect(parseJmsUrl(encoded)).toEqual({
      token: { id: 'tok-1', value: 'secret' },
      endpoint: { host: 'koko.example.com', port: 2222 },
      protocol: 'ssh',
      asset: { id: 'asset-1', name: 'web-1', address: '10.0.0.8' },
    })
  })

  it('fills token value from the create-token fallback when jms:// omits it', () => {
    const payload = {
      token: { id: 'tok-1' },
      endpoint: { host: 'koko.example.com', port: 2222 },
    }
    const encoded = `jms://${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')}`
    expect(parseJmsUrl(encoded, { value: 'from-create' }).token).toEqual({
      id: 'tok-1',
      value: 'from-create',
    })
  })

  it('ignores an array token field and reads id/value from the payload', () => {
    const payload = {
      token: ['tok-1'],
      id: 'tok-1',
      value: 'secret',
      endpoint: { host: 'koko.example.com', port: 2222 },
    }
    const encoded = `jms://${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')}`
    expect(parseJmsUrl(encoded).token).toEqual({ id: 'tok-1', value: 'secret' })
  })

  it('ignores a string token field and reads id/value from the payload', () => {
    const payload = {
      token: 'tok-1',
      id: 'tok-1',
      value: 'secret',
      endpoint: { host: 'koko.example.com', port: 2222 },
    }
    const encoded = `jms://${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')}`
    expect(parseJmsUrl(encoded).token).toEqual({ id: 'tok-1', value: 'secret' })
  })
})
