import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildSigningString, httpDate, signAccessKey } from '../src/auth.js'

describe('signAccessKey', () => {
  const headers = {
    accept: 'application/json',
    date: 'Tue, 15 Nov 1994 08:12:31 GMT',
  }

  it('builds the canonical string with lowercase header names and no trailing newline', () => {
    expect(buildSigningString({
      method: 'GET',
      path: '/api/v1/users/profile/',
      headers,
    })).toBe(
      '(request-target): get /api/v1/users/profile/\naccept: application/json\ndate: Tue, 15 Nov 1994 08:12:31 GMT',
    )
  })

  it('signs with HMAC-SHA256 and emits a JumpServer Authorization header', () => {
    const header = signAccessKey({
      keyId: 'kid-1',
      secret: 'test-secret',
      method: 'GET',
      path: '/api/v1/users/profile/',
      headers,
    })
    const expected = createHmac('sha256', 'test-secret')
      .update('(request-target): get /api/v1/users/profile/\naccept: application/json\ndate: Tue, 15 Nov 1994 08:12:31 GMT')
      .digest('base64')
    expect(header).toBe(
      `Signature keyId="kid-1",algorithm="hmac-sha256",headers="(request-target) accept date",signature="${expected}"`,
    )
  })

  it('includes the query string in (request-target)', () => {
    const signing = buildSigningString({
      method: 'POST',
      path: '/api/v1/perms/users/self/assets/?limit=10',
      headers,
    })
    expect(signing.startsWith('(request-target): post /api/v1/perms/users/self/assets/?limit=10\n')).toBe(true)
  })

  it('matches signed header names case-insensitively', () => {
    const signing = buildSigningString({
      method: 'GET',
      path: '/x',
      headers: { Accept: 'application/json', Date: headers.date },
    })
    expect(signing).toContain('accept: application/json')
    expect(signing).toContain(`date: ${headers.date}`)
  })

  it('formats HTTP-date via toUTCString', () => {
    expect(httpDate(new Date('1994-11-15T08:12:31.000Z'))).toBe('Tue, 15 Nov 1994 08:12:31 GMT')
  })
})
