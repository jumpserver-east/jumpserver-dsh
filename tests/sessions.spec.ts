import { describe, expect, it } from 'vitest'
import { decodeUtf8Prefix, SessionManager, type OpenSessionInput, type SshConnection } from '../src/sessions.js'
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
      return { path: remotePath, content: 'hello', encoding: 'utf8', truncated: false, byteLength: 5 }
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

describe('decodeUtf8Prefix', () => {
  it('drops a trailing incomplete Chinese code point', () => {
    const ni = Buffer.from('你', 'utf8')
    expect(decodeUtf8Prefix(ni.subarray(0, 2))).toBe('')
    expect(decodeUtf8Prefix(Buffer.concat([ni, ni.subarray(0, 1)]))).toBe('你')
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
