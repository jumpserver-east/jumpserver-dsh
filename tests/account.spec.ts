import { describe, expect, it } from 'vitest'
import { pickAccountRef, pickAccountRefDirect } from '../src/account.js'
import { JumpServerError } from '../src/types.js'

const accounts = [
  { id: '80f9752d-a628-4ac0-8e1f-c418bc7c0568', name: 'TimePassBy', username: 'root' },
  { id: 'aaaa1111-2222-3333-4444-555566667777', name: 'dup', username: 'alice' },
  { id: 'bbbb1111-2222-3333-4444-555566667777', name: 'dup', username: 'bob' },
  { id: 'cccc1111-2222-3333-4444-555566667777', name: 'one', username: 'shared' },
  { id: 'dddd1111-2222-3333-4444-555566667777', name: 'two', username: 'shared' },
]

describe('pickAccountRefDirect', () => {
  it('returns a UUID without looking at accounts', () => {
    expect(pickAccountRefDirect('80f9752d-a628-4ac0-8e1f-c418bc7c0568')).toEqual({
      account: '80f9752d-a628-4ac0-8e1f-c418bc7c0568',
      inputUsernameRequired: false,
    })
  })

  it('returns @USER / @INPUT without looking at accounts', () => {
    expect(pickAccountRefDirect('@USER')?.inputUsernameRequired).toBe(true)
    expect(pickAccountRefDirect('@INPUT')?.account).toBe('@INPUT')
  })

  it('returns undefined for a display name', () => {
    expect(pickAccountRefDirect('TimePassBy')).toBeUndefined()
  })

  it('rejects an empty account', () => {
    expect(() => pickAccountRefDirect('  ')).toThrow(JumpServerError)
  })
})

describe('pickAccountRef', () => {
  it('keeps a UUID as-is', () => {
    expect(pickAccountRef('80f9752d-a628-4ac0-8e1f-c418bc7c0568', accounts).account)
      .toBe('80f9752d-a628-4ac0-8e1f-c418bc7c0568')
  })

  it('maps a unique display name to the account id', () => {
    expect(pickAccountRef('TimePassBy', accounts).account).toBe('80f9752d-a628-4ac0-8e1f-c418bc7c0568')
  })

  it('maps a unique username to the account id', () => {
    expect(pickAccountRef('root', accounts).account).toBe('80f9752d-a628-4ac0-8e1f-c418bc7c0568')
  })

  it('rejects an ambiguous display name', () => {
    expect(() => pickAccountRef('dup', accounts)).toThrow(JumpServerError)
  })

  it('rejects an ambiguous username', () => {
    expect(() => pickAccountRef('shared', accounts)).toThrow(/multiple accounts with username/)
  })

  it('requires input_username for @USER', () => {
    expect(pickAccountRef('@USER', accounts).inputUsernameRequired).toBe(true)
  })
})
