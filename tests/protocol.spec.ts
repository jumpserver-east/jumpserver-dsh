import { describe, expect, it } from 'vitest'
import { isDatabaseProtocol, pickAssetProtocol, protocolNames } from '../src/protocol.js'

describe('isDatabaseProtocol', () => {
  it('recognizes common database protocols', () => {
    expect(isDatabaseProtocol('mysql')).toBe(true)
    expect(isDatabaseProtocol('PostgreSQL')).toBe(true)
    expect(isDatabaseProtocol('redis')).toBe(true)
    expect(isDatabaseProtocol('ssh')).toBe(false)
    expect(isDatabaseProtocol('sftp')).toBe(false)
  })
})

describe('pickAssetProtocol', () => {
  it('prefers an explicit protocol', () => {
    expect(pickAssetProtocol([{ name: 'mysql', port: 3306 }], 'SSH')).toBe('ssh')
  })

  it('picks a database protocol from the asset when protocol is omitted', () => {
    expect(pickAssetProtocol([{ name: 'mysql', port: 3306 }, { name: 'ssh', port: 22 }])).toBe('mysql')
  })

  it('falls back to ssh then the first listed protocol', () => {
    expect(pickAssetProtocol([{ name: 'ssh', port: 22 }])).toBe('ssh')
    expect(pickAssetProtocol(['telnet'])).toBe('telnet')
    expect(pickAssetProtocol(undefined)).toBe('ssh')
  })
})

describe('protocolNames', () => {
  it('reads string and {name} entries', () => {
    expect(protocolNames(['MySQL', { name: 'redis' }, { port: 22 }])).toEqual(['mysql', 'redis'])
  })
})
