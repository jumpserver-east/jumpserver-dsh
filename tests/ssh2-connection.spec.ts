import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { Client } from 'ssh2'
import { Ssh2Connection } from '../src/sessions.js'

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
