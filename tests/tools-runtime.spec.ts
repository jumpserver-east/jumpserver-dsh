import { describe, expect, it } from 'vitest'
import { SessionManager } from '../src/sessions.js'
import { openKokoSession } from '../src/tools-runtime.js'
import { JumpServerError } from '../src/types.js'
import type { ResolvedConfig } from '../src/config.js'

const config = { baseUrl: 'https://jms.example.com' } as ResolvedConfig

function tokenInput(endpointHost = 'koko.example.com') {
  return {
    token: { id: 'tok-live', protocol: 'ssh', date_expired: '2099-01-01T00:00:00Z' },
    client: {
      token: { id: 'tok-live', value: 'secret' },
      endpoint: { host: endpointHost, port: 2222 },
    },
    assetId: 'asset-1',
    account: 'root',
    protocol: 'ssh',
  }
}

describe('openKokoSession', () => {
  it('expires the token when KoKo SSH fails', async () => {
    const expired: string[] = []
    const sessions = new SessionManager({
      idleTimeoutMs: 60_000,
      execTimeoutMs: 5_000,
      outputMaxBytes: 1024,
      writeMaxBytes: 1024,
      connect: async () => {
        throw new JumpServerError('SSH connect failed')
      },
    })
    await expect(openKokoSession(
      { expireConnectionToken: async (id) => { expired.push(id) } },
      sessions,
      config,
      tokenInput(),
    )).rejects.toThrow('SSH connect failed')
    expect(expired).toEqual(['tok-live'])
  })

  it('expires the token when the KoKo host cannot be resolved', async () => {
    const expired: string[] = []
    const sessions = new SessionManager({
      idleTimeoutMs: 60_000,
      execTimeoutMs: 5_000,
      outputMaxBytes: 1024,
      writeMaxBytes: 1024,
      connect: async () => {
        throw new Error('should not open')
      },
    })
    await expect(openKokoSession(
      { expireConnectionToken: async (id) => { expired.push(id) } },
      sessions,
      { baseUrl: 'not-a-url' } as ResolvedConfig,
      tokenInput(''),
    )).rejects.toThrow(/KoKo endpoint host is empty/)
    expect(expired).toEqual(['tok-live'])
  })

  it('does not expire the token after a successful open', async () => {
    const expired: string[] = []
    const sessions = new SessionManager({
      idleTimeoutMs: 60_000,
      execTimeoutMs: 5_000,
      outputMaxBytes: 1024,
      writeMaxBytes: 1024,
      connect: async () => ({
        async exec() {
          return { exitCode: 0, stdout: '', stderr: '', truncated: false }
        },
        async readFile(remotePath) {
          return { path: remotePath, content: '', encoding: 'utf8' as const, truncated: false, byteLength: 0, capturedBytes: 0 }
        },
        async writeFile() {},
        async end() {},
        onClose() {},
      }),
    })
    const info = await openKokoSession(
      { expireConnectionToken: async (id) => { expired.push(id) } },
      sessions,
      config,
      tokenInput(),
    ) as { token_id: string; session_id: string }
    expect(info.token_id).toBe('tok-live')
    expect(expired).toEqual([])
    await sessions.disposeAll()
  })
})
