import { describe, expect, it } from 'vitest'
import { canonicalProtocol, isDatabaseProtocol, pickAssetProtocol, pickConnectProtocol, protocolNames } from '../src/protocol.js'

describe('canonicalProtocol', () => {
  it('maps mssql / postgres / mongo onto JumpServer names', () => {
    expect(canonicalProtocol('mssql')).toBe('sqlserver')
    expect(canonicalProtocol('MSSQL')).toBe('sqlserver')
    expect(canonicalProtocol('postgres')).toBe('postgresql')
    expect(canonicalProtocol('mongo')).toBe('mongodb')
    expect(canonicalProtocol('oracle')).toBe('oracle')
  })
})

describe('isDatabaseProtocol', () => {
  it('recognizes common database protocols and aliases', () => {
    expect(isDatabaseProtocol('mysql')).toBe(true)
    expect(isDatabaseProtocol('PostgreSQL')).toBe(true)
    expect(isDatabaseProtocol('mssql')).toBe(true)
    expect(isDatabaseProtocol('redis')).toBe(true)
    expect(isDatabaseProtocol('ssh')).toBe(false)
    expect(isDatabaseProtocol('sftp')).toBe(false)
  })
})

describe('pickAssetProtocol', () => {
  it('prefers an explicit protocol', () => {
    expect(pickAssetProtocol([{ name: 'mysql', port: 3306 }], 'SSH')).toBe('ssh')
  })

  it('canonicalizes an explicit mssql alias', () => {
    expect(pickAssetProtocol([{ name: 'ssh', port: 22 }], 'mssql')).toBe('sqlserver')
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

describe('pickConnectProtocol', () => {
  it('uses asset type when protocols are missing', () => {
    expect(pickConnectProtocol({ type: 'sqlserver', category: 'database' })).toBe('sqlserver')
    expect(pickConnectProtocol({ type: 'mssql', category: 'database' })).toBe('sqlserver')
  })

  it('uses category=database when type is also missing', () => {
    expect(pickConnectProtocol({ category: 'database' })).toBe('mysql')
  })
})

describe('protocolNames', () => {
  it('reads string and {name} entries and canonicalizes aliases', () => {
    expect(protocolNames(['MySQL', { name: 'mssql' }, { port: 22 }])).toEqual(['mysql', 'sqlserver'])
  })
})
