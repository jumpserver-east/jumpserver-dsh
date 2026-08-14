import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { Server, utils, type Client } from 'ssh2'
import { connectSsh2, Ssh2Connection, type SshConnection } from '../src/sessions.js'

const { OPEN_MODE, STATUS_CODE } = utils.sftp
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

  it('reads and writes files over a reused SFTP channel', async () => {
    const files = new Map<string, Buffer>([['/tmp/hello.txt', Buffer.from('hello-sftp')]])
    const conn = await openAgainst(servers, conns, (session) => {
      session.on('sftp', (accept) => attachMemorySftp(accept(), files))
    })
    const read = await conn.readFile('/tmp/hello.txt', 4_096)
    expect(read.content).toBe('hello-sftp')
    await conn.writeFile('/tmp/out.txt', Buffer.from('written'))
    expect(files.get('/tmp/out.txt')?.toString()).toBe('written')
    const again = await conn.readFile('/tmp/hello.txt', 4_096)
    expect(again.content).toBe('hello-sftp')
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

function attachMemorySftp(
  sftp: import('ssh2').SFTPWrapper & {
    handle(reqid: number, handle: Buffer): void
    status(reqid: number, code: number): void
    data(reqid: number, data: Buffer): void
    attrs(reqid: number, attrs: object): void
    name(reqid: number, names: object[]): void
  },
  files: Map<string, Buffer>,
): void {
  const handles = new Map<number, { path: string; chunks?: Buffer[] }>()
  let next = 1
  sftp.on('OPEN', (reqid, filename, flags) => {
    const id = next
    next += 1
    const handle = Buffer.alloc(4)
    handle.writeUInt32BE(id, 0)
    handles.set(id, {
      path: filename,
      chunks: flags & OPEN_MODE.WRITE ? [] : undefined,
    })
    sftp.handle(reqid, handle)
  })
  sftp.on('READ', (reqid, handle, offset, length) => {
    const rec = handles.get(handle.readUInt32BE(0))
    const data = rec ? files.get(rec.path) : undefined
    if (!data || offset >= data.length) {
      sftp.status(reqid, STATUS_CODE.EOF)
      return
    }
    sftp.data(reqid, data.subarray(offset, offset + length))
  })
  sftp.on('WRITE', (reqid, handle, _offset, data) => {
    const rec = handles.get(handle.readUInt32BE(0))
    if (!rec?.chunks) {
      sftp.status(reqid, STATUS_CODE.FAILURE)
      return
    }
    rec.chunks.push(data)
    sftp.status(reqid, STATUS_CODE.OK)
  })
  sftp.on('CLOSE', (reqid, handle) => {
    const rec = handles.get(handle.readUInt32BE(0))
    if (rec?.chunks) files.set(rec.path, Buffer.concat(rec.chunks))
    handles.delete(handle.readUInt32BE(0))
    sftp.status(reqid, STATUS_CODE.OK)
  })
  const onStat = (reqid: number, path: string) => {
    const data = files.get(path)
    if (!data) {
      sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE)
      return
    }
    sftp.attrs(reqid, {
      mode: 0o100644,
      uid: 0,
      gid: 0,
      size: data.length,
      atime: 0,
      mtime: 0,
    })
  }
  sftp.on('STAT', onStat)
  sftp.on('LSTAT', onStat)
  sftp.on('FSTAT', (reqid, handle) => {
    const rec = handles.get(handle.readUInt32BE(0))
    onStat(reqid, rec?.path ?? '')
  })
  sftp.on('REALPATH', (reqid, path) => {
    sftp.name(reqid, [{ filename: path, longname: path, attrs: {} }])
  })
}
