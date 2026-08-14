import { describe, expect, it } from 'vitest'
import { pickAccountRef } from '../src/account.js'
import { JumpServerError } from '../src/types.js'

const accounts = [
  { id: '80f9752d-a628-4ac0-8e1f-c418bc7c0568', name: 'TimePassBy', username: 'root' },
  { id: 'aaaa1111-2222-3333-4444-555566667777', name: 'dup', username: 'alice' },
  { id: 'bbbb1111-2222-3333-4444-555566667777', name: 'dup', username: 'bob' },
]

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

  it('requires input_username for @USER', () => {
    expect(pickAccountRef('@USER', accounts).inputUsernameRequired).toBe(true)
  })
})
