import { describe, expect, it } from 'vitest'
import { hostnameFromUrl, resolveKokoEndpoint } from '../src/koko-endpoint.js'

describe('resolveKokoEndpoint', () => {
  it('keeps a configured endpoint host', () => {
    expect(resolveKokoEndpoint({ host: 'koko.internal', port: 2222 }, 'https://jms.example.com')).toEqual({
      host: 'koko.internal',
      port: 2222,
    })
  })

  it('fills an empty Default host from the Core URL hostname', () => {
    expect(resolveKokoEndpoint({ host: '', port: 2222 }, 'https://jms.example.com:443/')).toEqual({
      host: 'jms.example.com',
      port: 2222,
    })
  })

  it('does not rewrite 0.0.0.0 or 127.0.0.1', () => {
    expect(resolveKokoEndpoint({ host: '0.0.0.0', port: 2222 }, 'https://jms.example.com').host).toBe('0.0.0.0')
    expect(resolveKokoEndpoint({ host: '127.0.0.1', port: 2222 }, 'https://jms.example.com').host).toBe('127.0.0.1')
  })
})

describe('hostnameFromUrl', () => {
  it('returns only the hostname', () => {
    expect(hostnameFromUrl('https://10.1.14.47:8080')).toBe('10.1.14.47')
  })
})
