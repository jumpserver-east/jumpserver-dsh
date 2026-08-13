import { createHmac } from 'node:crypto'

/** Headers included in JumpServer Access Key signatures, in signing order. */
export const ACCESS_KEY_SIGNED_HEADERS = ['(request-target)', 'accept', 'date'] as const

/** Inputs for one HMAC-SHA256 HTTP signature. */
export interface AccessKeySignInput {
  /** Access Key ID (`keyId`). */
  keyId: string
  /** Access Key secret. */
  secret: string
  /** HTTP method. */
  method: string
  /** Request path including query string, for example `/api/v1/users/profile/?x=1`. */
  path: string
  /** Header map used for signing. Keys are matched case-insensitively. */
  headers: Record<string, string>
}

/**
 * Build the canonical signing string used by JumpServer / HTTP Signatures.
 * Header names in the string are lowercase; the last line has no trailing newline.
 */
export function buildSigningString(input: Pick<AccessKeySignInput, 'method' | 'path' | 'headers'>): string {
  const headerMap = lowerHeaderMap(input.headers)
  const requestTarget = `${input.method.toLowerCase()} ${input.path}`
  const lines = [`(request-target): ${requestTarget}`]
  for (const name of ACCESS_KEY_SIGNED_HEADERS.slice(1)) {
    const value = headerMap[name]
    if (value === undefined) {
      throw new Error(`JumpServer Access Key signing requires the ${name} header`)
    }
    lines.push(`${name}: ${value}`)
  }
  return lines.join('\n')
}

/**
 * Create a JumpServer `Authorization` header for Access Key authentication.
 *
 * Format:
 * `Signature keyId="...",algorithm="hmac-sha256",headers="(request-target) accept date",signature="..."`
 */
export function signAccessKey(input: AccessKeySignInput): string {
  const signingString = buildSigningString(input)
  const signature = createHmac('sha256', input.secret).update(signingString, 'utf8').digest('base64')
  const headers = ACCESS_KEY_SIGNED_HEADERS.join(' ')
  return `Signature keyId="${input.keyId}",algorithm="hmac-sha256",headers="${headers}",signature="${signature}"`
}

/** Format an Instant as HTTP-date (RFC 7231). */
export function httpDate(date: Date = new Date()): string {
  return date.toUTCString()
}

function lowerHeaderMap(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = value
  }
  return out
}
