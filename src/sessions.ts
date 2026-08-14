import { randomUUID } from 'node:crypto'
import { Client, type SFTPWrapper } from 'ssh2'
import { formatNetworkError } from './errors.js'
import { JumpServerError } from './types.js'

/** Result of one remote command. */
export interface ExecResult {
  exitCode: number | null
  signal?: string
  stdout: string
  stderr: string
  truncated: boolean
  timedOut?: boolean
}

/** Result of one SFTP read. */
export interface FileReadResult {
  path: string
  content: string
  encoding: 'utf8' | 'base64'
  truncated: boolean
  /** Remote file size when SFTP stat succeeds; otherwise the captured byte count. */
  byteLength: number
  capturedBytes: number
}

/** Public facts about an open KoKo session. */
export interface SessionInfo {
  session_id: string
  asset_id: string
  account: string
  host: string
  port: number
  protocol: string
  connected_at: string
  token_id?: string
}

/** Parameters used to open KoKo SSH. */
export interface OpenSessionInput {
  host: string
  port: number
  username: string
  password: string
  assetId: string
  account: string
  protocol: string
  tokenId?: string
  readyTimeoutMs?: number
}

/** Minimal SSH surface used by the session manager (and tests). */
export interface SshConnection {
  exec(command: string, opts: { signal?: AbortSignal; timeoutMs: number; maxBytes: number }): Promise<ExecResult>
  readFile(remotePath: string, maxBytes: number, signal?: AbortSignal): Promise<FileReadResult>
  writeFile(remotePath: string, data: Buffer, signal?: AbortSignal): Promise<void>
  end(signal?: AbortSignal): Promise<void>
  onClose(cb: () => void): void
}

/** Session manager options. */
export interface SessionManagerOptions {
  idleTimeoutMs: number
  execTimeoutMs: number
  outputMaxBytes: number
  writeMaxBytes: number
  connect?: (input: OpenSessionInput, signal?: AbortSignal) => Promise<SshConnection>
  /** Called once when a session leaves the map, including idle timeout and unload. */
  onClosed?: (tokenId: string) => void | Promise<void>
}

interface LiveSession {
  info: SessionInfo
  connection: SshConnection
  timer?: ReturnType<typeof setTimeout>
  inFlight: number
}

/** Holds KoKo SSH sessions for `jms_exec` / SFTP tools. */
export class SessionManager {
  private readonly sessions = new Map<string, LiveSession>()
  private readonly options: SessionManagerOptions
  private readonly connectFn: (input: OpenSessionInput, signal?: AbortSignal) => Promise<SshConnection>

  constructor(options: SessionManagerOptions) {
    this.options = options
    this.connectFn = options.connect ?? connectSsh2
  }

  /** Open a KoKo SSH session and return its public info. */
  async open(input: OpenSessionInput, signal?: AbortSignal): Promise<SessionInfo> {
    const connection = await this.connectFn(input, signal)
    const info: SessionInfo = {
      session_id: `jms-${randomUUID()}`,
      asset_id: input.assetId,
      account: input.account,
      host: input.host,
      port: input.port,
      protocol: input.protocol,
      connected_at: new Date().toISOString(),
      ...(input.tokenId ? { token_id: input.tokenId } : {}),
    }
    const live: LiveSession = {
      info,
      connection,
      inFlight: 0,
    }
    this.sessions.set(info.session_id, live)
    this.scheduleIdle(live)
    connection.onClose(() => {
      const current = this.sessions.get(info.session_id)
      if (!current) return
      this.sessions.delete(info.session_id)
      if (current.timer) clearTimeout(current.timer)
      void this.notifyClosed(current.info)
    })
    return info
  }

  /** Run a command on an existing session. */
  async exec(sessionId: string, command: string, signal?: AbortSignal): Promise<ExecResult & { session_id: string; command: string }> {
    const live = this.require(sessionId)
    const result = await this.withBusy(live, () => live.connection.exec(command, {
      signal,
      timeoutMs: this.options.execTimeoutMs,
      maxBytes: this.options.outputMaxBytes,
    }))
    return { session_id: sessionId, command, ...result }
  }

  /** Read a remote file over SFTP. */
  async readFile(sessionId: string, remotePath: string, signal?: AbortSignal): Promise<FileReadResult & { session_id: string }> {
    const live = this.require(sessionId)
    const result = await this.withBusy(live, () => live.connection.readFile(remotePath, this.options.outputMaxBytes, signal))
    return { session_id: sessionId, ...result }
  }

  /** Write a remote file over SFTP. */
  async writeFile(sessionId: string, remotePath: string, content: string, encoding: 'utf8' | 'base64', signal?: AbortSignal): Promise<{ session_id: string; path: string; byteLength: number }> {
    const live = this.require(sessionId)
    const data = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8')
    if (data.byteLength > this.options.writeMaxBytes) {
      throw new JumpServerError(
        `write exceeds writeMaxBytes (${data.byteLength} > ${this.options.writeMaxBytes})`,
      )
    }
    await this.withBusy(live, () => live.connection.writeFile(remotePath, data, signal))
    return { session_id: sessionId, path: remotePath, byteLength: data.byteLength }
  }

  /** Close one session. Unknown ids are a no-op. */
  async disconnect(sessionId: string, signal?: AbortSignal): Promise<{ closed: boolean; session_id: string; token_id?: string }> {
    const live = this.sessions.get(sessionId)
    if (!live) return { closed: false, session_id: sessionId }
    this.sessions.delete(sessionId)
    if (live.timer) clearTimeout(live.timer)
    await live.connection.end(signal)
    await this.notifyClosed(live.info)
    return { closed: true, session_id: sessionId, ...(live.info.token_id ? { token_id: live.info.token_id } : {}) }
  }

  /** List live sessions. */
  list(): SessionInfo[] {
    return [...this.sessions.values()].map(session => session.info)
  }

  /** Close every session (plugin unload). */
  async disposeAll(): Promise<void> {
    const ids = [...this.sessions.keys()]
    await Promise.all(ids.map(id => this.disconnect(id)))
  }

  /** Run the close hook. Never rejects: a failed token expire must not fail the close. */
  private async notifyClosed(info: SessionInfo): Promise<void> {
    const tokenId = info.token_id
    if (!tokenId || !this.options.onClosed) return
    try {
      await this.options.onClosed(tokenId)
    } catch {
      // Token may already be expired or Core unreachable.
    }
  }

  private require(sessionId: string): LiveSession {
    const live = this.sessions.get(sessionId)
    if (!live) {
      throw new JumpServerError(`unknown JumpServer session: ${sessionId}`)
    }
    return live
  }

  private async withBusy<T>(live: LiveSession, work: () => Promise<T>): Promise<T> {
    live.inFlight += 1
    try {
      return await work()
    } finally {
      live.inFlight -= 1
      if (this.sessions.get(live.info.session_id) === live) this.scheduleIdle(live)
    }
  }

  private scheduleIdle(live: LiveSession): void {
    if (live.timer) clearTimeout(live.timer)
    live.timer = setTimeout(() => {
      if (live.inFlight > 0) {
        this.scheduleIdle(live)
        return
      }
      void this.disconnect(live.info.session_id)
    }, this.options.idleTimeoutMs)
    live.timer.unref?.()
  }
}

/** Open an ssh2 client to KoKo. */
export async function connectSsh2(input: OpenSessionInput, signal?: AbortSignal): Promise<SshConnection> {
  const client = await openClient(input, signal)
  return new Ssh2Connection(client)
}

function openClient(input: OpenSessionInput, signal?: AbortSignal): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    let settled = false
    const finish = (error?: Error, value?: Client) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(value as Client)
    }
    const onAbort = () => {
      client.end()
      finish(new JumpServerError('SSH connect aborted'))
    }
    if (signal?.aborted) {
      finish(new JumpServerError('SSH connect aborted'))
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    client.on('ready', () => finish(undefined, client))
    client.on('error', (error) => finish(new JumpServerError(
      `SSH connect ${input.host}:${input.port} failed: ${formatNetworkError(error)}`,
    )))
    client.connect({
      host: input.host,
      port: input.port,
      username: input.username,
      password: input.password,
      readyTimeout: input.readyTimeoutMs ?? 20_000,
      keepaliveInterval: 15_000,
    })
  })
}

const SSH_END_TIMEOUT_MS = 3_000

export class Ssh2Connection implements SshConnection {
  private sftp?: SFTPWrapper
  private sftpPending?: Promise<SFTPWrapper>
  private sftpPendingReject?: (error: Error) => void
  private sftpOpenId = 0
  private sftpWaiters = 0
  private closed = false
  private readonly closeListeners: Array<() => void> = []

  constructor(private readonly client: Client) {
    this.client.on('close', () => {
      this.closed = true
      this.sftp = undefined
      this.sftpPending = undefined
      this.sftpPendingReject = undefined
      this.sftpOpenId += 1
      this.sftpWaiters = 0
      for (const listener of this.closeListeners) listener()
    })
  }

  onClose(cb: () => void): void {
    if (this.closed) {
      cb()
      return
    }
    this.closeListeners.push(cb)
  }

  private getSftp(signal?: AbortSignal): Promise<SFTPWrapper> {
    if (this.sftp) return Promise.resolve(this.sftp)
    if (signal?.aborted) return Promise.reject(new JumpServerError('SFTP open aborted'))
    if (!this.sftpPending) {
      const pending = this.openSftp()
      pending.catch(() => {
        if (this.sftpPending === pending) {
          this.sftpPending = undefined
          this.sftpPendingReject = undefined
        }
      })
      if (!this.sftp) this.sftpPending = pending
    }
    if (this.sftp) return Promise.resolve(this.sftp)
    if (!this.sftpPending) return Promise.reject(new JumpServerError('SFTP open failed'))
    return this.awaitSftp(this.sftpPending, signal)
  }

  private openSftp(): Promise<SFTPWrapper> {
    const openId = this.sftpOpenId + 1
    this.sftpOpenId = openId
    return new Promise<SFTPWrapper>((resolve, reject) => {
      this.sftpPendingReject = reject
      this.client.sftp((error, sftp) => {
        if (this.sftpOpenId !== openId) {
          if (!error) {
            try {
              sftp.end()
            } catch {
              // Channel arrived after abort or teardown.
            }
          }
          return
        }
        if (error) {
          reject(error)
          return
        }
        const onChannelClose = () => {
          if (this.sftp === sftp) this.sftp = undefined
        }
        sftp.on('close', onChannelClose)
        sftp.on('end', onChannelClose)
        this.sftp = sftp
        this.sftpPending = undefined
        this.sftpPendingReject = undefined
        resolve(sftp)
      })
    })
  }

  private awaitSftp(pending: Promise<SFTPWrapper>, signal?: AbortSignal): Promise<SFTPWrapper> {
    this.sftpWaiters += 1
    let released = false
    const release = () => {
      if (released) return
      released = true
      this.sftpWaiters = Math.max(0, this.sftpWaiters - 1)
    }
    if (!signal) return pending.finally(release)
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        release()
        if (this.sftpWaiters === 0) this.abandonPendingSftp()
        reject(new JumpServerError('SFTP open aborted'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      pending.then(
        (sftp) => {
          signal.removeEventListener('abort', onAbort)
          release()
          resolve(sftp)
        },
        (error) => {
          signal.removeEventListener('abort', onAbort)
          release()
          reject(error)
        },
      )
    })
  }

  private abandonPendingSftp(): void {
    if (!this.sftpPending) return
    const reject = this.sftpPendingReject
    this.sftpPending = undefined
    this.sftpPendingReject = undefined
    this.sftpOpenId += 1
    reject?.(new JumpServerError('SFTP open aborted'))
  }

  exec(command: string, opts: { signal?: AbortSignal; timeoutMs: number; maxBytes: number }): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      this.client.exec(command, (error, stream) => {
        if (error) {
          reject(error)
          return
        }
        const budget: ByteBudget = { remaining: opts.maxBytes, truncated: false }
        const stdout = new CappedBuffer(budget)
        const stderr = new CappedBuffer(budget)
        let settled = false
        let stdoutClosed = false
        let stderrClosed = false
        let exitCode: number | null | undefined
        let signalName: string | undefined
        const result = (): ExecResult => ({
          exitCode: typeof exitCode === 'number' ? exitCode : null,
          ...(signalName ? { signal: signalName } : {}),
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          truncated: budget.truncated,
        })
        const tryFinish = () => {
          if (!stdoutClosed || !stderrClosed) return
          finish(undefined, result())
        }
        const timer = setTimeout(() => {
          finish(undefined, { ...result(), timedOut: true })
          stream.destroy()
        }, opts.timeoutMs)
        const onAbort = () => {
          stream.destroy()
          finish(new JumpServerError('command aborted'))
        }
        const finish = (err?: Error, value?: ExecResult) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          opts.signal?.removeEventListener('abort', onAbort)
          if (err) reject(err)
          else resolve(value as ExecResult)
        }
        if (opts.signal?.aborted) {
          stream.destroy()
          finish(new JumpServerError('command aborted'))
          return
        }
        opts.signal?.addEventListener('abort', onAbort, { once: true })
        stream.on('data', (chunk: Buffer) => stdout.push(chunk))
        stream.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
        stream.on('close', (code: number | null, name?: string) => {
          exitCode = code
          signalName = name
          stdoutClosed = true
          tryFinish()
        })
        const onStderrDone = () => {
          stderrClosed = true
          tryFinish()
        }
        stream.stderr.on('end', onStderrDone)
        stream.stderr.on('close', onStderrDone)
        stream.on('error', (streamError: Error) => finish(streamError))
        stream.stderr.on('error', (streamError: Error) => finish(streamError))
      })
    })
  }

  async readFile(remotePath: string, maxBytes: number, signal?: AbortSignal): Promise<FileReadResult> {
    const sftp = await this.getSftp(signal)
    return new Promise((resolve, reject) => {
      let settled = false
      const onAbort = () => {
        stream.destroy()
        finish(new JumpServerError('read aborted'))
      }
      const finish = (error?: Error, value?: FileReadResult) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        if (error) reject(error)
        else resolve(value as FileReadResult)
      }
      const chunks: Buffer[] = []
      let size = 0
      let truncated = false
      const stream = sftp.createReadStream(remotePath)
      if (signal?.aborted) {
        stream.destroy()
        finish(new JumpServerError('read aborted'))
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      stream.on('data', (chunk: Buffer) => {
        if (size >= maxBytes) {
          truncated = true
          stream.destroy()
          return
        }
        const room = maxBytes - size
        const piece = chunk.length > room ? chunk.subarray(0, room) : chunk
        chunks.push(piece)
        size += piece.length
        if (chunk.length > room) {
          truncated = true
          stream.destroy()
        }
      })
      stream.on('error', (streamError: Error) => finish(streamError))
      stream.on('close', () => {
        const buf = Buffer.concat(chunks, size)
        const decoded = decodeBuffer(buf, truncated)
        const capturedBytes = buf.byteLength
        const done = (remoteSize?: number) => {
          finish(undefined, {
            path: remotePath,
            content: decoded.content,
            encoding: decoded.encoding,
            truncated,
            byteLength: remoteSize ?? capturedBytes,
            capturedBytes,
          })
        }
        if (!truncated) {
          done()
          return
        }
        void remoteFileSize(sftp, remotePath).then(done)
      })
    })
  }

  async writeFile(remotePath: string, data: Buffer, signal?: AbortSignal): Promise<void> {
    const sftp = await this.getSftp(signal)
    return new Promise((resolve, reject) => {
      let settled = false
      const onAbort = () => {
        stream.destroy()
        finish(new JumpServerError('write aborted'))
      }
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        if (error) reject(error)
        else resolve()
      }
      const stream = sftp.createWriteStream(remotePath)
      if (signal?.aborted) {
        stream.destroy()
        finish(new JumpServerError('write aborted'))
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      stream.on('error', (streamError: Error) => finish(streamError))
      stream.on('close', () => finish())
      stream.end(data)
    })
  }

  async end(signal?: AbortSignal): Promise<void> {
    this.abandonPendingSftp()
    const sftp = this.sftp
    this.sftp = undefined
    try {
      sftp?.end()
    } catch {
      // Channel may already be gone.
    }
    if (this.closed) return
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }
      const onAbort = () => {
        try {
          this.client.destroy()
        } catch {
          // Ignore a second teardown.
        }
        this.closed = true
        done()
      }
      const timer = setTimeout(() => {
        try {
          this.client.destroy()
        } catch {
          // Ignore a second teardown.
        }
        this.closed = true
        done()
      }, SSH_END_TIMEOUT_MS)
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.client.once('close', done)
      this.client.end()
    })
  }
}

/** Output allowance shared by one command's stdout and stderr. */
export interface ByteBudget {
  remaining: number
  truncated: boolean
}

/**
 * Captures a stream's bytes against a shared budget.
 * `cut` is per-buffer so an untouched stream is never clipped on a UTF-8 boundary.
 */
export class CappedBuffer {
  private chunks: Buffer[] = []
  private size = 0
  private cut = false

  constructor(private readonly budget: ByteBudget) {}

  push(chunk: Buffer): void {
    if (this.budget.remaining <= 0) {
      this.budget.truncated = true
      this.cut = true
      return
    }
    const room = this.budget.remaining
    if (chunk.length > room) {
      this.chunks.push(chunk.subarray(0, room))
      this.size += room
      this.budget.remaining = 0
      this.budget.truncated = true
      this.cut = true
      return
    }
    this.chunks.push(chunk)
    this.size += chunk.length
    this.budget.remaining -= chunk.length
  }

  toString(): string {
    return decodeUtf8Captured(Buffer.concat(this.chunks, this.size), this.cut)
  }
}

function remoteFileSize(sftp: SFTPWrapper, remotePath: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    try {
      sftp.stat(remotePath, (error, attrs) => {
        if (error || attrs == null || typeof attrs.size !== 'number') resolve(undefined)
        else resolve(attrs.size)
      })
    } catch {
      resolve(undefined)
    }
  })
}

/** Decode bytes; only clip a trailing incomplete code point when the buffer was cut. */
export function decodeUtf8Captured(buf: Buffer, truncated: boolean): string {
  return truncated ? decodeUtf8Prefix(buf) : buf.toString('utf8')
}

/** Decode a byte prefix without emitting a replacement char for a cut code point. */
export function decodeUtf8Prefix(buf: Buffer): string {
  return buf.subarray(0, utf8SafeEnd(buf)).toString('utf8')
}

function utf8SafeEnd(buf: Buffer): number {
  if (buf.length === 0) return 0
  let i = buf.length - 1
  let cont = 0
  while (i >= 0 && (buf[i]! & 0xc0) === 0x80) {
    cont += 1
    i -= 1
    if (cont === 3) break
  }
  if (i < 0) return 0
  const lead = buf[i]!
  const expected =
    (lead & 0x80) === 0 ? 0
      : (lead & 0xe0) === 0xc0 ? 1
        : (lead & 0xf0) === 0xe0 ? 2
          : (lead & 0xf8) === 0xf0 ? 3
            : -1
  if (expected < 0) return i
  if (cont < expected) return i
  return buf.length
}

function decodeBuffer(buf: Buffer, truncated: boolean): { content: string; encoding: 'utf8' | 'base64' } {
  if (buf.includes(0)) {
    return { content: buf.toString('base64'), encoding: 'base64' }
  }
  return { content: decodeUtf8Captured(buf, truncated), encoding: 'utf8' }
}
