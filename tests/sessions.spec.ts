import { describe, expect, it } from 'vitest'
import { CappedBuffer, decodeUtf8Captured, decodeUtf8Prefix, SessionManager, type OpenSessionInput, type SshConnection } from '../src/sessions.js'
import { JumpServerError } from '../src/types.js'

function fakeConnection(): SshConnection & { ended: boolean; commands: string[]; fireClose: () => void } {
  const commands: string[] = []
  const closeListeners: Array<() => void> = []
  return {
    commands,
    ended: false,
    async exec(command) {
      commands.push(command)
      return { exitCode: 0, stdout: `ok:${command}`, stderr: '', truncated: false }
    },
    async readFile(remotePath) {
      return { path: remotePath, content: 'hello', encoding: 'utf8', truncated: false, byteLength: 5, capturedBytes: 5 }
    },
    async writeFile() {},
    async end() {
      this.ended = true
    },
    onClose(cb) {
      closeListeners.push(cb)
    },
    fireClose() {
      for (const listener of closeListeners) listener()
    },
  }
}

describe('SessionManager', () => {
  it('opens, execs, and disconnects a session', async () => {
    const conn = fakeConnection()
    const manager = new SessionManager({
      idleTimeoutMs: 60_000,
      execTimeoutMs: 5_000,
      outputMaxBytes: 1024,
      writeMaxBytes: 1024,
      connect: async () => conn,
    })
    const info = await manager.open(input())
    expect(info.session_id.startsWith('jms-')).toBe(true)
    expect(manager.list()).toHaveLength(1)
    const result = await manager.exec(info.session_id, 'uname -a')
    expect(result.stdout).toBe('ok:uname -a')
    expect(conn.commands).toEqual(['uname -a'])
    await expect(manager.disconnect(info.session_id)).resolves.toEqual({
      closed: true,
      session_id: info.session_id,
    })
    expect(conn.ended).toBe(true)
    expect(manager.list()).toHaveLength(0)
  })

  it('returns token_id from disconnect so the caller can expire it', async () => {
    const closed: string[] = []
    const manager = new SessionManager({
      idleTimeoutMs: 60_000,
      execTimeoutMs: 5_000,
      outputMaxBytes: 1024,
      writeMaxBytes: 1024,
      onClosed: (tokenId) => { closed.push(tokenId) },
      connect: async () => fakeConnection(),
    })
    const info = await manager.open({ ...input(), tokenId: 'tok-1' })
    expect(info.token_id).toBe('tok-1')
    await expect(manager.disconnect(info.session_id)).resolves.toEqual({
      closed: true,
      session_id: info.session_id,
      token_id: 'tok-1',
    })
    expect(closed).toEqual(['tok-1'])
  })

  it('notifies onClosed when a session idles out or is disposed', async () => {
    const closed: string[] = []
    const idle = new SessionManager({
      idleTimeoutMs: 15,
      execTimeoutMs: 5_000,
      outputMaxBytes: 1024,
      writeMaxBytes: 1024,
      onClosed: (tokenId) => { closed.push(tokenId) },
      connect: async () => fakeConnection(),
    })
    await idle.open({ ...input(), tokenId: 'tok-idle' })
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(closed).toEqual(['tok-idle'])
    expect(idle.list()).toHaveLength(0)

    const disposed = new SessionManager({
      idleTimeoutMs: 60_000,
      execTimeoutMs: 5_000,
      outputMaxBytes: 1024,
      writeMaxBytes: 1024,
      onClosed: (tokenId) => { closed.push(tokenId) },
      connect: async () => fakeConnection(),
    })
    await disposed.open({ ...input(), tokenId: 'tok-unload' })
    await disposed.disposeAll()
    expect(closed).toEqual(['tok-idle', 'tok-unload'])
  })

  it('waits for onClosed before disconnect and disposeAll resolve', async () => {
    let expireStarted = 0
    let expireFinished = 0
    const onClosed = async () => {
      expireStarted += 1
      await new Promise(resolve => setTimeout(resolve, 25))
      expireFinished += 1
    }
    const manager = new SessionManager({
      idleTimeoutMs: 60_000,
      execTimeoutMs: 5_000,
      outputMaxBytes: 1024,
      writeMaxBytes: 1024,
      onClosed,
      connect: async () => fakeConnection(),
    })
    const first = await manager.open({ ...input(), tokenId: 'tok-wait' })
    await manager.disconnect(first.session_id)
    expect(expireStarted).toBe(1)
    expect(expireFinished).toBe(1)

    await manager.open({ ...input(), tokenId: 'tok-unload' })
    await manager.disposeAll()
    expect(expireStarted).toBe(2)
    expect(expireFinished).toBe(2)
  })

  it('notifies onClosed when the SSH connection drops', async () => {
    const closed: string[] = []
    const conn = fakeConnection()
    const manager = new SessionManager({
      idleTimeoutMs: 60_000,
      execTimeoutMs: 5_000,
      outputMaxBytes: 1024,
      writeMaxBytes: 1024,
      onClosed: (tokenId) => { closed.push(tokenId) },
      connect: async () => conn,
    })
    await manager.open({ ...input(), tokenId: 'tok-drop' })
    conn.fireClose()
    expect(closed).toEqual(['tok-drop'])
  })

  it('rejects unknown session ids', async () => {
    const manager = new SessionManager({
      idleTimeoutMs: 60_000,
      execTimeoutMs: 5_000,
      outputMaxBytes: 1024,
      writeMaxBytes: 1024,
      connect: async () => fakeConnection(),
    })
    await expect(manager.exec('missing', 'true')).rejects.toBeInstanceOf(JumpServerError)
  })

  it('drops a session when the SSH connection closes', async () => {
    const conn = fakeConnection()
    const manager = new SessionManager({
      idleTimeoutMs: 60_000,
      execTimeoutMs: 5_000,
      outputMaxBytes: 1024,
      writeMaxBytes: 1024,
      connect: async () => conn,
    })
    const info = await manager.open(input())
    expect(manager.list()).toHaveLength(1)
    conn.fireClose()
    expect(manager.list()).toHaveLength(0)
    await expect(manager.disconnect(info.session_id)).resolves.toEqual({
      closed: false,
      session_id: info.session_id,
    })
  })

  it('does not idle-disconnect while a command is running', async () => {
    const conn = fakeConnection()
    conn.exec = async (command) => {
      await new Promise(resolve => setTimeout(resolve, 40))
      return { exitCode: 0, stdout: `ok:${command}`, stderr: '', truncated: false }
    }
    const manager = new SessionManager({
      idleTimeoutMs: 15,
      execTimeoutMs: 5_000,
      outputMaxBytes: 1024,
      writeMaxBytes: 1024,
      connect: async () => conn,
    })
    const info = await manager.open(input())
    const result = await manager.exec(info.session_id, 'sleep')
    expect(result.stdout).toBe('ok:sleep')
    expect(manager.list()).toHaveLength(1)
    await manager.disposeAll()
  })

  it('rejects oversized writes', async () => {
    const manager = new SessionManager({
      idleTimeoutMs: 60_000,
      execTimeoutMs: 5_000,
      outputMaxBytes: 1024,
      writeMaxBytes: 4,
      connect: async () => fakeConnection(),
    })
    const info = await manager.open(input())
    await expect(manager.writeFile(info.session_id, '/tmp/x', 'hello', 'utf8')).rejects.toBeInstanceOf(JumpServerError)
    await manager.disposeAll()
  })
})

describe('CappedBuffer', () => {
  it('does not clip an uncut stream when the shared budget is exhausted', () => {
    const budget = { remaining: 50, truncated: false }
    const stderr = new CappedBuffer(budget)
    const stdout = new CappedBuffer(budget)
    stderr.push(Buffer.from([0x41, 0x80]))
    stdout.push(Buffer.alloc(80, 0x53))
    expect(stderr.toString()).toBe('A\uFFFD')
    expect(budget.truncated).toBe(true)
    expect(Buffer.byteLength(stdout.toString(), 'utf8')).toBe(48)
  })
})

describe('decodeUtf8Prefix', () => {
  it('drops a trailing incomplete Chinese code point', () => {
    const ni = Buffer.from('你', 'utf8')
    expect(decodeUtf8Prefix(ni.subarray(0, 2))).toBe('')
    expect(decodeUtf8Prefix(Buffer.concat([ni, ni.subarray(0, 1)]))).toBe('你')
  })
})

describe('decodeUtf8Captured', () => {
  it('keeps replacement characters when the buffer was not truncated', () => {
    const invalid = Buffer.from([0x41, 0x80])
    expect(decodeUtf8Captured(invalid, false)).toBe('A\uFFFD')
  })

  it('clips an incomplete trailing code point only when truncated', () => {
    const ni = Buffer.from('你', 'utf8')
    const cut = Buffer.concat([ni, ni.subarray(0, 1)])
    expect(decodeUtf8Captured(cut, true)).toBe('你')
    expect(decodeUtf8Captured(cut, false).endsWith('\uFFFD')).toBe(true)
  })
})

function input(): OpenSessionInput {
  return {
    host: 'koko.example.com',
    port: 2222,
    username: 'JMS-tok',
    password: 'secret',
    assetId: 'asset-1',
    account: 'root',
    protocol: 'ssh',
  }
}
