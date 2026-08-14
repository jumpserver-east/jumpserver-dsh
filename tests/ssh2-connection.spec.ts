import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { Server, utils, type Client } from 'ssh2'
import { connectSsh2, Ssh2Connection, type SshConnection } from '../src/sessions.js'

const hostKey = utils.generateKeyPairSync('ed25519').private

describe('Ssh2Connection.getSftp', () => {
  it('does not cache a synchronously rejected sftp promise', async () => {
    let calls = 0
    const client = fakeClient((cb) => {
      calls += 1
      if (calls === 1) {
        cb(new Error('No free channels available'))
        return
      }
      cb(undefined, readableSftp(Buffer.from('recovered')))
    })
    const conn = new Ssh2Connection(client)
    await expect(conn.readFile('/x', 32)).rejects.toThrow('No free channels')
    const result = await conn.readFile('/x', 32)
    expect(result.content).toBe('recovered')
    expect(calls).toBe(2)
  })

  it('does not clear a newer sftp session on a late close', async () => {
    const opened: EventEmitter[] = []
    const client = fakeClient((cb) => {
      const sftp = readableSftp(Buffer.from(`n${opened.length + 1}`))
      opened.push(sftp)
      cb(undefined, sftp)
    })
    const conn = new Ssh2Connection(client)
    expect((await conn.readFile('/x', 32)).content).toBe('n1')
    opened[0]!.emit('close')
    expect((await conn.readFile('/x', 32)).content).toBe('n2')
    opened[0]!.emit('close')
    expect((await conn.readFile('/x', 32)).content).toBe('n2')
    expect(opened).toHaveLength(2)
  })
})

describe('Ssh2Connection.exec exit code', () => {
  const servers: Server[] = []
  const conns: SshConnection[] = []

  afterEach(async () => {
    await Promise.all(conns.splice(0).map(conn => conn.end().catch(() => undefined)))
    await Promise.all(servers.splice(0).map(server => closeServer(server)))
  })

  it('returns a numeric exit code', async () => {
    const conn = await openAgainst(servers, conns, (session) => {
      session.on('exec', (accept, _reject, info) => {
        const stream = accept()
        stream.write(`out:${info.command}`)
        stream.stderr.write('err')
        stream.exit(7)
        stream.end()
      })
    })
    const result = await conn.exec('uname', { timeoutMs: 2_000, maxBytes: 4_096 })
    expect(result.stdout).toBe('out:uname')
    expect(result.stderr).toBe('err')
    expect(result.exitCode).toBe(7)
  })

  it('treats a missing exit-status as null, not undefined', async () => {
    const conn = await openAgainst(servers, conns, (session) => {
      session.on('exec', (accept) => {
        const stream = accept()
        stream.write('out')
        stream.end()
      })
    })
    const result = await conn.exec('no-status', { timeoutMs: 2_000, maxBytes: 4_096 })
    expect(result.exitCode).toBeNull()
    expect(result.stdout).toBe('out')
    expect(Object.hasOwn(result, 'exitCode')).toBe(true)
  })

  it('keeps captured output when a command times out', async () => {
    const conn = await openAgainst(servers, conns, (session) => {
      session.on('exec', (accept) => {
        const stream = accept()
        stream.write('partial-out')
        stream.stderr.write('partial-err')
      })
    })
    const result = await conn.exec('hang', { timeoutMs: 80, maxBytes: 4_096 })
    expect(result.timedOut).toBe(true)
    expect(result.stdout).toBe('partial-out')
    expect(result.stderr).toBe('partial-err')
    expect(result.exitCode).toBeNull()
  })

  it('waits for a late stderr chunk before settling', async () => {
    const conn = await openAgainst(servers, conns, (session) => {
      session.on('exec', (accept) => {
        const stream = accept()
        stream.write('out')
        stream.exit(0)
        setImmediate(() => {
          stream.stderr.write('late')
          stream.end()
        })
      })
    })
    const result = await conn.exec('late-err', { timeoutMs: 2_000, maxBytes: 4_096 })
    expect(result.stdout).toBe('out')
    expect(result.stderr).toBe('late')
    expect(result.exitCode).toBe(0)
  })
})

function fakeClient(sftp: Client['sftp']): Client {
  const client = new EventEmitter() as Client
  client.sftp = sftp
  return client
}

function readableSftp(data: Buffer): EventEmitter & { createReadStream: () => PassThrough } {
  return Object.assign(new EventEmitter(), {
    createReadStream() {
      const stream = new PassThrough()
      queueMicrotask(() => {
        stream.end(data)
      })
      return stream
    },
  })
}

async function openAgainst(
  servers: Server[],
  conns: SshConnection[],
  onSession: (session: import('ssh2').Session) => void,
): Promise<SshConnection> {
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on('authentication', (ctx) => ctx.accept())
    client.on('ready', () => {
      client.on('session', (accept) => {
        onSession(accept())
      })
    })
  })
  servers.push(server)
  const port = await listen(server)
  const conn = await connectSsh2({
    host: '127.0.0.1',
    port,
    username: 'user',
    password: 'pass',
    assetId: 'asset-1',
    account: 'root',
    protocol: 'ssh',
    readyTimeoutMs: 5_000,
  })
  conns.push(conn)
  return conn
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (typeof addr === 'object' && addr) resolve(addr.port)
      else reject(new Error('SSH test server has no port'))
    })
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve())
  })
}
