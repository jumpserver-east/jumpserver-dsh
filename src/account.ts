import { JumpServerError } from './types.js'
import type { AccountSummary } from './types.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Result of mapping a tool account argument onto a Core token account field. */
export interface ResolvedAccountRef {
  account: string
  inputUsernameRequired: boolean
}

/**
 * Resolve @USER / @INPUT / UUID without consulting the account list.
 * Empty input throws. Display names and usernames return undefined.
 */
export function pickAccountRefDirect(requested: string): ResolvedAccountRef | undefined {
  const raw = requested.trim()
  if (!raw) throw new JumpServerError('account must be non-empty')
  if (raw.startsWith('@')) {
    const special = raw.toUpperCase()
    return {
      account: raw,
      inputUsernameRequired: special === '@USER' || special === '@INPUT',
    }
  }
  if (UUID_RE.test(raw)) return { account: raw, inputUsernameRequired: false }
  return undefined
}

/**
 * Prefer account id, then username. Display names are only used when unique.
 * Unknown strings are passed through so Core aliases still work.
 */
export function pickAccountRef(requested: string, accounts: AccountSummary[]): ResolvedAccountRef {
  const direct = pickAccountRefDirect(requested)
  if (direct) return direct
  const raw = requested.trim()

  const byId = accounts.filter(row => row.id === raw)
  if (byId.length === 1 && byId[0]?.id) return { account: byId[0].id, inputUsernameRequired: false }

  const byUsername = accounts.filter(row => row.username === raw)
  if (byUsername.length > 1) {
    throw ambiguousAccount('username', raw, byUsername)
  }
  if (byUsername.length === 1) {
    return { account: byUsername[0]?.id || byUsername[0]?.username || raw, inputUsernameRequired: false }
  }

  const byName = accounts.filter(row => row.name === raw)
  if (byName.length > 1) {
    throw ambiguousAccount('named', raw, byName)
  }
  if (byName.length === 1) {
    return { account: byName[0]?.id || byName[0]?.username || raw, inputUsernameRequired: false }
  }

  return { account: raw, inputUsernameRequired: false }
}

function ambiguousAccount(kind: 'username' | 'named', raw: string, rows: AccountSummary[]): JumpServerError {
  const ids = rows.map(row => row.id ?? row.username ?? '?').join(', ')
  const label = kind === 'username' ? `with username ${JSON.stringify(raw)}` : `named ${JSON.stringify(raw)}`
  return new JumpServerError(`multiple accounts ${label}; pass an account id (${ids})`)
}
