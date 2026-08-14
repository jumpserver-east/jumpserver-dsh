import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  extractDbResult,
  formatDbCommand,
  isStatementComplete,
  looksLikeDbConnectError,
  looksLikeDbPrompt,
  looksLikeUsqlReady,
  Ssh2DbConnection,
  stripAnsi,
  terminalQueryReplies,
} from '../src/db-session.js'
import type { Client, ClientChannel } from 'ssh2'

describe('looksLikeDbPrompt', () => {
  it('matches usql and sqlplus prompts', () => {
    expect(looksLikeDbPrompt('system@orcl:xe=> ')).toBe(true)
    expect(looksLikeDbPrompt('sqlserver=>')).toBe(true)
    expect(looksLikeDbPrompt('oracle=> ')).toBe(true)
    expect(looksLikeDbPrompt('SQL> ')).toBe(true)
    expect(looksLikeDbPrompt('127.0.0.1:6379> ')).toBe(true)
    expect(looksLikeDbPrompt('Connected with driver oracle\n')).toBe(false)
  })

  it('matches a prompt that still has a cursor-position query after it', () => {
    expect(looksLikeDbPrompt('sqlserver=> \x1b[6n')).toBe(true)
    expect(looksLikeDbPrompt('oracle=>\x1b[?2004h')).toBe(true)
  })
})

describe('looksLikeUsqlReady', () => {
  it('treats the usql help / driver banner as a live session', () => {
    expect(looksLikeUsqlReady('Connected with driver sqlserver (Microsoft SQL Server 16.0.1000)\nType "help" for help.\n')).toBe(true)
    expect(looksLikeUsqlReady('Connected with driver oracle (Oracle 23.0.0.0.0)\n')).toBe(true)
    expect(looksLikeUsqlReady('Unable to connect: connection refused\n')).toBe(false)
  })
})

describe('terminalQueryReplies', () => {
  it('answers linenoise cursor and window queries', () => {
    expect(terminalQueryReplies('sqlserver=> \x1b[6n')).toEqual(['\x1b[1;1R'])
    expect(terminalQueryReplies('\x1b[18t')).toEqual(['\x1b[8;40;240t'])
  })
})

describe('looksLikeDbConnectError', () => {
  it('matches KoKo exec rejection and usql connect failures', () => {
    expect(looksLikeDbConnectError('not ssh asset connection token')).toBe(true)
    expect(looksLikeDbConnectError('Unable to connect: connection refused')).toBe(true)
    expect(looksLikeDbConnectError('ORA-01017: invalid username/password')).toBe(true)
    expect(looksLikeDbConnectError('Type "help" for help.')).toBe(false)
  })
})

describe('formatDbCommand', () => {
  it('adds a semicolon for SQL and leaves Redis alone', () => {
    expect(formatDbCommand('SELECT 1 FROM dual', 'oracle')).toBe('SELECT 1 FROM dual;\n')
    expect(formatDbCommand('SELECT 1;', 'sqlserver')).toBe('SELECT 1;\n')
    expect(formatDbCommand('GET foo', 'redis')).toBe('GET foo\n')
  })
})

describe('extractDbResult', () => {
  it('drops the echoed command and the trailing prompt', () => {
    const captured = 'SELECT 1 FROM dual;\n  D\n---\n  1\n\nsystem@orcl:xe=> '
    expect(extractDbResult(captured, 'SELECT 1 FROM dual;')).toBe('  D\n---\n  1')
  })

  it('drops a prompt-prefixed echo line from linenoise', () => {
    const captured = 'sqlserver=> SELECT 1;\n  1\n---\n  1\n\nsqlserver=> '
    expect(extractDbResult(captured, 'SELECT 1;')).toBe('  1\n---\n  1')
  })
})

describe('isStatementComplete', () => {
  it('ignores an idle prompt with no new output', () => {
    expect(isStatementComplete('sqlserver=> ')).toBe(false)
    expect(isStatementComplete('')).toBe(false)
  })

  it('requires a new prompt after a newline', () => {
    expect(isStatementComplete('SELECT 1;\n  1\n---\n  1\n\nsqlserver=> ')).toBe(true)
    expect(isStatementComplete('SELECT 1;')).toBe(false)
  })
})

describe('stripAnsi', () => {
  it('removes CSI sequences', () => {
    expect(stripAnsi('\x1b[32msystem@orcl:xe=> \x1b[0m')).toBe('system@orcl:xe=> ')
  })
})

describe('Ssh2DbConnection', () => {
  it('opens a PTY, waits for the usql prompt, then runs SQL on the same shell', async () => {
    const fake = fakeDbClient()
    const pending = Ssh2DbConnection.open(fake.client, 'oracle')
    await new Promise(resolve => setTimeout(resolve, 10))
    fake.emit('Connected with driver oracle\nType "help" for help.\n\nsystem@orcl:xe=> ')
    const conn = await pending
    const query = conn.exec('SELECT 1 FROM dual', { timeoutMs: 1_000, maxBytes: 4_096 })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(fake.writes.join('')).toContain('SELECT 1 FROM dual;')
    let finished = false
    void query.then(() => {
      finished = true
    })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(finished).toBe(false)
    fake.emit('SELECT 1 FROM dual;\n  D\n---\n  1\n\nsystem@orcl:xe=> ')
    const result = await query
    expect(result.stdout).toContain('1')
    expect(result.exitCode).toBe(0)
    await conn.end()
  })

  it('does not treat the connect-time prompt as the end of a later query', async () => {
    const fake = fakeDbClient()
    const pending = Ssh2DbConnection.open(fake.client, 'sqlserver')
    await new Promise(resolve => setTimeout(resolve, 10))
    fake.emit('Connected with driver sqlserver (Microsoft SQL Server 16.0)\nType "help" for help.\n\nsqlserver=> ')
    const conn = await pending
    const query = conn.exec('SELECT 1', { timeoutMs: 800, maxBytes: 4_096 })
    await new Promise(resolve => setTimeout(resolve, 50))
    let finished = false
    void query.then(() => {
      finished = true
    })
    await new Promise(resolve => setTimeout(resolve, 450))
    expect(finished).toBe(false)
    fake.emit('SELECT 1;\n  1\n---\n  1\n\nsqlserver=> ')
    const result = await query
    expect(result.stdout).toMatch(/1/)
    await conn.end()
  })

  it('fails connect when usql reports the database is down', async () => {
    const fake = fakeDbClient()
    const pending = Ssh2DbConnection.open(fake.client, 'sqlserver', undefined, 500)
    await new Promise(resolve => setTimeout(resolve, 10))
    fake.emit('Unable to connect: connection refused\n')
    await expect(pending).rejects.toThrow(/connection refused/)
  })

  it('becomes ready from the usql banner when the prompt is delayed', async () => {
    const fake = fakeDbClient()
    const pending = Ssh2DbConnection.open(fake.client, 'sqlserver', undefined, 2_000)
    await new Promise(resolve => setTimeout(resolve, 10))
    fake.emit('Connected with driver sqlserver (Microsoft SQL Server 16.0.1000)\nType "help" for help.\n')
    await expect(pending).resolves.toBeInstanceOf(Ssh2DbConnection)
    expect(fake.writes.some(chunk => chunk.includes('\x1b[1;1R') || chunk.includes('SELECT'))).toBe(false)
    await (await pending).end()
  })

  it('replies to a cursor-position query so usql can flush sqlserver=>', async () => {
    const fake = fakeDbClient()
    const pending = Ssh2DbConnection.open(fake.client, 'sqlserver', undefined, 2_000)
    await new Promise(resolve => setTimeout(resolve, 10))
    fake.emit('Connected with driver sqlserver (Microsoft SQL Server 16.0)\n\x1b[6n')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(fake.writes.join('')).toContain('\x1b[1;1R')
    fake.emit('sqlserver=> ')
    const conn = await pending
    await conn.end()
  })
})

function fakeDbClient(): {
  client: Client
  emit: (text: string) => void
  writes: string[]
} {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const writes: string[] = []
  const stream = stdout as PassThrough & ClientChannel
  stream.stderr = stderr
  const client = new EventEmitter() as Client
  client.shell = ((_opts, cb) => {
    cb(undefined, stream)
    return client
  }) as Client['shell']
  client.end = () => {
    stdout.end()
    client.emit('close')
    return client
  }
  client.destroy = () => {
    stdout.destroy()
    client.emit('close')
    return client
  }
  stream.write = ((chunk: string | Buffer, encoding?: BufferEncoding, cb?: (error?: Error | null) => void) => {
    writes.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'))
    const done = typeof encoding === 'function' ? encoding : cb
    done?.()
    return true
  }) as typeof stream.write
  return {
    client,
    emit(text: string) {
      stdout.emit('data', Buffer.from(text))
    },
    writes,
  }
}
