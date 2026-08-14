import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_ORG_ID } from '../src/config.js'
import { resolveEnableAssetAdmin, resolveEnableDbWrite, resolveOrgId } from '../src/credentials.js'

describe('resolveOrgId', () => {
  afterEach(() => {
    delete process.env.JUMPSERVER_ORG_ID
  })

  it('uses JumpServer Default org when nothing is set', () => {
    delete process.env.JUMPSERVER_ORG_ID
    expect(resolveOrgId({})).toBe(DEFAULT_ORG_ID)
  })

  it('reads JUMPSERVER_ORG_ID from the environment', () => {
    process.env.JUMPSERVER_ORG_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    expect(resolveOrgId({})).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
  })

  it('prefers config.orgId over the environment', () => {
    process.env.JUMPSERVER_ORG_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    expect(resolveOrgId({ orgId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }))
      .toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
  })
})

describe('resolveEnableAssetAdmin', () => {
  afterEach(() => {
    delete process.env.JUMPSERVER_ENABLE_ASSET_ADMIN
  })

  it('defaults to false', () => {
    delete process.env.JUMPSERVER_ENABLE_ASSET_ADMIN
    expect(resolveEnableAssetAdmin({})).toBe(false)
  })

  it('reads JUMPSERVER_ENABLE_ASSET_ADMIN=true', () => {
    process.env.JUMPSERVER_ENABLE_ASSET_ADMIN = 'true'
    expect(resolveEnableAssetAdmin({})).toBe(true)
  })

  it('treats 1 as true and 0 as false', () => {
    process.env.JUMPSERVER_ENABLE_ASSET_ADMIN = '1'
    expect(resolveEnableAssetAdmin({})).toBe(true)
    process.env.JUMPSERVER_ENABLE_ASSET_ADMIN = '0'
    expect(resolveEnableAssetAdmin({})).toBe(false)
  })

  it('prefers config.enableAssetAdmin over the environment', () => {
    process.env.JUMPSERVER_ENABLE_ASSET_ADMIN = 'true'
    expect(resolveEnableAssetAdmin({ enableAssetAdmin: false })).toBe(false)
  })

  it('rejects an invalid value', () => {
    process.env.JUMPSERVER_ENABLE_ASSET_ADMIN = 'maybe'
    expect(() => resolveEnableAssetAdmin({})).toThrow(/JUMPSERVER_ENABLE_ASSET_ADMIN/)
  })
})

describe('resolveEnableDbWrite', () => {
  afterEach(() => {
    delete process.env.JUMPSERVER_ENABLE_DB_WRITE
  })

  it('defaults to false', () => {
    delete process.env.JUMPSERVER_ENABLE_DB_WRITE
    expect(resolveEnableDbWrite({})).toBe(false)
  })

  it('reads JUMPSERVER_ENABLE_DB_WRITE=true', () => {
    process.env.JUMPSERVER_ENABLE_DB_WRITE = 'true'
    expect(resolveEnableDbWrite({})).toBe(true)
  })

  it('prefers config.enableDbWrite over the environment', () => {
    process.env.JUMPSERVER_ENABLE_DB_WRITE = 'true'
    expect(resolveEnableDbWrite({ enableDbWrite: false })).toBe(false)
  })

  it('rejects an invalid value', () => {
    process.env.JUMPSERVER_ENABLE_DB_WRITE = 'maybe'
    expect(() => resolveEnableDbWrite({})).toThrow(/JUMPSERVER_ENABLE_DB_WRITE/)
  })
})
