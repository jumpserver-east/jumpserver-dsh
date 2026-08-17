import type { Client, ClientChannel } from '#ssh2'
import type { ExecResult, FileReadResult, SshConnection } from './sessions.js'
import { JumpServerError } from './types.js'

const CONNECT_ERROR = /not ssh asset connection token|unable to connect|connection refused|login failed|access denied|authentication failed|connect failed|no route to host|host blocked|ORA-\d{5}|timeout expired|could not connect/i

const USQL_READY = /Type "help" for help\.?|Connected with driver\s+\S+/i

/** usql `sqlserver=>` / `pg:user@host=>`, sqlplus `SQL>`, sqlcmd `1>`, redis `host:port>`. */
const PROMPT_RE = /(?:=>|SQL>)\s*$|(?:^|\n)(?:\S+:\d+>|\d+>)\s*$/i

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[()][AB012]|\x1b[=>]|[\x00-\x08\x0b\x0c\x0e-\x1f]|\r/g

/** Strip CSI / OSC / leftover C0 so prompt matching sees plain text. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

function lastNonEmptyLine(text: string): string {
  const lines = stripAnsi(text).split('\n').map(line => line.trimEnd()).filter(line => line.length > 0)
  return lines[lines.length - 1] ?? ''
}

/** True when KoKo/usql is waiting for the next statement. */
export function looksLikeDbPrompt(text: string): boolean {
  const clean = stripAnsi(text)
  if (PROMPT_RE.test(clean)) return true
  const last = lastNonEmptyLine(text)
  if (!last || last.length > 120) return false
  if (/=>\s*$/.test(last)) return true
  if (/^(?:SQL>|sql>)\s*$/i.test(last)) return true
  if (/\b(?:sqlserver|mssql|oracle|mysql|mariadb|postgres|postgresql|redis|mongo(?:db)?)\s*=>?\s*$/i.test(last)) return true
  return false
}

/** usql prints this only after the driver session is actually up. */
export function looksLikeUsqlReady(text: string): boolean {
  return USQL_READY.test(stripAnsi(text)) && !looksLikeDbConnectError(text)
}

/** Reply to linenoise/usql cursor and window queries so the prompt is flushed. */
export function terminalQueryReplies(chunk: string): string[] {
  const replies: string[] = []
  if (chunk.includes('\x1b[6n')) replies.push('\x1b[1;1R')
  if (chunk.includes('\x1b[18t')) replies.push('\x1b[8;40;240t')
  if (/\x1b\[0?c/.test(chunk)) replies.push('\x1b[?1;2c')
  return replies
}

/** True when the banner says the database never came up. */
export function looksLikeDbConnectError(text: string): boolean {
  return CONNECT_ERROR.test(stripAnsi(text))
}

/** Terminate SQL for usql; leave Redis / Mongo commands alone. */
export function formatDbCommand(sql: string, protocol: string): string {
  const text = sql.replace(/\s+$/u, '')
  if (!text) throw new JumpServerError('sql must be non-empty')
  const kind = protocol.trim().toLowerCase()
  if (kind === 'redis' || kind === 'mongodb' || kind === 'mongo') return `${text}\n`
  if (/[;\\][gG]?$/.test(text)) return `${text}\n`
  return `${text};\n`
}

/** Drop the echoed command and the trailing prompt from a PTY capture. */
export function extractDbResult(captured: string, command: string): string {
  const lines = stripAnsi(captured).replace(/\r/g, '').split('\n')
  const sent = command.replace(/\s+$/u, '')
  if (lines[0] !== undefined) {
    const first = lines[0].trim()
    if (first === sent.trim() || first.endsWith(sent.trim())) lines.shift()
  }
  while (lines.length > 0 && looksLikeDbPrompt(`${lines[lines.length - 1]}\n`)) {
    lines.pop()
  }
  return lines.join('\n').replace(/^\n+/, '').replace(/\n+$/, '')
}

/** A query is done only when a *new* prompt arrives after some output (not the idle prompt already on screen). */
export function isStatementComplete(suffix: string): boolean {
  if (!looksLikeDbPrompt(suffix)) return false
  return stripAnsi(suffix).includes('\n')
}

/**
 * KoKo database tokens reject SSH exec (`not ssh asset connection token`).
 * SQL goes through an interactive PTY that usql / sqlplus / redis-cli own.
 */
export class Ssh2DbConnection implements SshConnection {
  private closed = false
  private readonly closeListeners: Array<() => void> = []
  private queue: Promise<unknown> = Promise.resolve()
  private buffer = ''

  private constructor(
    private readonly client: Client,
    private readonly stream: ClientChannel,
    private readonly protocol: string,
  ) {
    this.stream.on('data', (chunk: Buffer) => {
      this.onChunk(chunk.toString('utf8'))
    })
    this.stream.stderr?.on('data', (chunk: Buffer) => {
      this.onChunk(chunk.toString('utf8'))
    })
    const onClose = () => {
      this.closed = true
      for (const listener of this.closeListeners) listener()
    }
    this.stream.on('close', onClose)
    this.client.on('close', onClose)
  }

  static async open(client: Client, protocol: string, signal?: AbortSignal, timeoutMs = 20_000): Promise<Ssh2DbConnection> {
    const stream = await openShell(client, signal)
    try {
      stream.setWindow?.(40, 240, 480, 1920)
    } catch {
      // Older ssh2 channels may not expose setWindow.
    }
    const conn = new Ssh2DbConnection(client, stream, protocol)
    try {
      await conn.waitForPrompt(signal, timeoutMs, 'database session did not become ready', 0)
    } catch (error) {
      try {
        stream.end()
      } catch {
        // Teardown is best-effort.
      }
      try {
        client.end()
      } catch {
        // Teardown is best-effort.
      }
      throw error
    }
    return conn
  }

  onClose(cb: () => void): void {
    if (this.closed) {
      cb()
      return
    }
    this.closeListeners.push(cb)
  }

  exec(command: string, opts: { signal?: AbortSignal; timeoutMs: number; maxBytes: number }): Promise<ExecResult> {
    return this.enqueue(() => this.runStatement(command, opts))
  }

  async readFile(): Promise<FileReadResult> {
    throw new JumpServerError('SFTP is not available on database sessions; use jms_sql')
  }

  async writeFile(): Promise<void> {
    throw new JumpServerError('SFTP is not available on database sessions; use jms_sql')
  }

  async end(signal?: AbortSignal): Promise<void> {
    if (this.closed) return
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        this.closed = true
        resolve()
      }
      const onAbort = () => {
        try {
          this.client.destroy()
        } catch {
          // Ignore a second teardown.
        }
        done()
      }
      const timer = setTimeout(() => {
        try {
          this.client.destroy()
        } catch {
          // Ignore a second teardown.
        }
        done()
      }, 3_000)
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.client.once('close', done)
      try {
        this.stream.write('\q\n')
      } catch {
        // Shell may already be gone.
      }
      this.stream.end()
      this.client.end()
    })
  }

  private onChunk(text: string): void {
    for (const reply of terminalQueryReplies(text)) {
      try {
        this.stream.write(reply)
      } catch {
        // Channel may already be closing.
      }
    }
    this.buffer += text
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  private async runStatement(
    command: string,
    opts: { signal?: AbortSignal; timeoutMs: number; maxBytes: number },
  ): Promise<ExecResult> {
    if (this.closed) throw new JumpServerError('database session is closed')
    const payload = formatDbCommand(command, this.protocol)
    const mark = this.buffer.length
    this.stream.write(payload.endsWith('\n') ? payload.replace(/\n$/u, '\r\n') : `${payload}\r\n`)
    try {
      await this.waitForPrompt(opts.signal, opts.timeoutMs, 'database statement timed out', mark)
      const captured = this.buffer.slice(mark)
      const stdout = extractDbResult(captured, payload.replace(/\n$/, '')).slice(0, opts.maxBytes)
      return {
        exitCode: 0,
        stdout,
        stderr: '',
        truncated: stripAnsi(captured).length > opts.maxBytes,
      }
    } catch (error) {
      if (error instanceof JumpServerError && /timed out/.test(error.message)) {
        try {
          this.stream.write('\x03')
        } catch {
          // Ctrl-C is best-effort.
        }
        return {
          exitCode: null,
          stdout: extractDbResult(this.buffer.slice(mark), payload.replace(/\n$/, '')).slice(0, opts.maxBytes),
          stderr: error.message,
          truncated: false,
          timedOut: true,
        }
      }
      throw error
    }
  }

  private waitForPrompt(
    signal: AbortSignal | undefined,
    timeoutMs: number,
    timeoutLabel: string,
    since: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      let readyArmed = false
      let settle: ReturnType<typeof setTimeout> | undefined
      const suffix = () => this.buffer.slice(since)
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (settle) clearTimeout(settle)
        this.stream.removeListener('data', onData)
        this.stream.stderr?.removeListener('data', onData)
        this.stream.removeListener('close', onClose)
        signal?.removeEventListener('abort', onAbort)
        if (error) reject(error)
        else resolve()
      }
      const inspect = () => {
        const text = suffix()
        if (since === 0 && looksLikeDbConnectError(this.buffer)) {
          finish(new JumpServerError(`database connection failed: ${summarizeBanner(this.buffer)}`))
          return
        }
        if (since === 0 ? looksLikeDbPrompt(text) : isStatementComplete(text)) {
          finish()
          return
        }
        if (since === 0 && looksLikeUsqlReady(this.buffer) && !readyArmed) {
          readyArmed = true
          settle = setTimeout(() => {
            if (looksLikeDbConnectError(this.buffer)) {
              finish(new JumpServerError(`database connection failed: ${summarizeBanner(this.buffer)}`))
              return
            }
            finish()
          }, 400)
        }
      }
      const onData = () => inspect()
      const onClose = () => {
        finish(new JumpServerError(`database session closed: ${summarizeBanner(this.buffer)}`))
      }
      const onAbort = () => finish(new JumpServerError('database session aborted'))
      const timer = setTimeout(() => {
        finish(new JumpServerError(`${timeoutLabel}: ${summarizeBanner(this.buffer)}`))
      }, timeoutMs)
      if (signal?.aborted) {
        finish(new JumpServerError('database session aborted'))
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.stream.on('data', onData)
      this.stream.stderr?.on('data', onData)
      this.stream.on('close', onClose)
      inspect()
    })
  }
}

function openShell(client: Client, signal?: AbortSignal): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error, stream?: ClientChannel) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(stream as ClientChannel)
    }
    const onAbort = () => finish(new JumpServerError('database shell aborted'))
    if (signal?.aborted) {
      finish(new JumpServerError('database shell aborted'))
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    client.shell({ term: 'xterm', cols: 240, rows: 40 }, (error, stream) => {
      if (error) finish(error)
      else finish(undefined, stream)
    })
  })
}

function summarizeBanner(text: string): string {
  const clean = stripAnsi(text).trim()
  if (!clean) return '(no output)'
  const lines = clean.split('\n').map(line => line.trim()).filter(Boolean)
  return lines.slice(-4).join(' | ').slice(0, 400)
}

