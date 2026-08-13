import { randomUUID } from 'node:crypto'
import { Client } from 'ssh2'
import { JumpServerError } from './types.js'

/** Result of one remote command. */
export interface ExecResult {
  exitCode: number | null
  signal?: string
  stdout: string
  stderr: string
  truncated: boolean
}

/** Result of one SFTP read. */
export interface FileReadResult {
  path: string
  content: string
  encoding: 'utf8' | 'base64'
  truncated: boolean
  byteLength: number
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
  readyTimeoutMs?: number
}

/** Minimal SSH surface used by the session manager (and tests). */
export interface SshConnection {
  exec(command: string, opts: { signal?: AbortSignal; timeoutMs: number; maxBytes: number }): Promise<ExecResult>
  readFile(remotePath: string, maxBytes: number): Promise<FileReadResult>
  writeFile(remotePath: string, data: Buffer): Promise<void>
  end(): Promise<void>
}

/** Session manager options. */
export interface SessionManagerOptions {
  idleTimeoutMs: number
  execTimeoutMs: number
  outputMaxBytes: number
  writeMaxBytes: number
  connect?: (input: OpenSessionInput, signal?: AbortSignal) => Promise<SshConnection>
}

interface LiveSession {
  info: SessionInfo
  connection: SshConnection
  timer: ReturnType<typeof setTimeout>
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
    }
    const live: LiveSession = {
      info,
      connection,
      timer: setTimeout(() => {
        void this.disconnect(info.session_id)
      }, this.options.idleTimeoutMs),
    }
    live.timer.unref?.()
    this.sessions.set(info.session_id, live)
    return info
  }

  /** Run a command on an existing session. */
  async exec(sessionId: string, command: string, signal?: AbortSignal): Promise<ExecResult & { session_id: string; command: string }> {
    const live = this.require(sessionId)
    this.touch(live)
    const result = await live.connection.exec(command, {
      signal,
      timeoutMs: this.options.execTimeoutMs,
      maxBytes: this.options.outputMaxBytes,
    })
    this.touch(live)
    return { session_id: sessionId, command, ...result }
  }

  /** Read a remote file over SFTP. */
  async readFile(sessionId: string, remotePath: string): Promise<FileReadResult & { session_id: string }> {
    const live = this.require(sessionId)
    this.touch(live)
    const result = await live.connection.readFile(remotePath, this.options.outputMaxBytes)
    this.touch(live)
    return { session_id: sessionId, ...result }
  }

  /** Write a remote file over SFTP. */
  async writeFile(sessionId: string, remotePath: string, content: string, encoding: 'utf8' | 'base64'): Promise<{ session_id: string; path: string; byteLength: number }> {
    const live = this.require(sessionId)
    const data = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8')
    if (data.byteLength > this.options.writeMaxBytes) {
      throw new JumpServerError(
        `write exceeds writeMaxBytes (${data.byteLength} > ${this.options.writeMaxBytes})`,
      )
    }
    this.touch(live)
    await live.connection.writeFile(remotePath, data)
    this.touch(live)
    return { session_id: sessionId, path: remotePath, byteLength: data.byteLength }
  }

  /** Close one session. Unknown ids are a no-op. */
  async disconnect(sessionId: string): Promise<{ closed: boolean; session_id: string }> {
    const live = this.sessions.get(sessionId)
    if (!live) return { closed: false, session_id: sessionId }
    this.sessions.delete(sessionId)
    clearTimeout(live.timer)
    await live.connection.end()
    return { closed: true, session_id: sessionId }
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

  private require(sessionId: string): LiveSession {
    const live = this.sessions.get(sessionId)
    if (!live) {
      throw new JumpServerError(`unknown JumpServer session: ${sessionId}`)
    }
    return live
  }

  private touch(live: LiveSession): void {
    clearTimeout(live.timer)
    live.timer = setTimeout(() => {
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
    client.on('error', (error) => finish(error instanceof Error ? error : new Error(String(error))))
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

class Ssh2Connection implements SshConnection {
  constructor(private readonly client: Client) {}

  exec(command: string, opts: { signal?: AbortSignal; timeoutMs: number; maxBytes: number }): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      this.client.exec(command, (error, stream) => {
        if (error) {
          reject(error)
          return
        }
        const stdout = new CappedBuffer(opts.maxBytes)
        const stderr = new CappedBuffer(opts.maxBytes)
        let settled = false
        const timer = setTimeout(() => {
          stream.destroy()
          finish(new JumpServerError(`command timed out after ${opts.timeoutMs}ms`))
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
        stream.on('close', (code: number | null, signalName?: string) => {
          finish(undefined, {
            exitCode: code,
            ...(signalName ? { signal: signalName } : {}),
            stdout: stdout.toString(),
            stderr: stderr.toString(),
            truncated: stdout.truncated || stderr.truncated,
          })
        })
        stream.on('error', (streamError: Error) => finish(streamError))
      })
    })
  }

  readFile(remotePath: string, maxBytes: number): Promise<FileReadResult> {
    return new Promise((resolve, reject) => {
      this.client.sftp((error, sftp) => {
        if (error) {
          reject(error)
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        let truncated = false
        const stream = sftp.createReadStream(remotePath)
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
        stream.on('error', reject)
        stream.on('close', () => {
          const buf = Buffer.concat(chunks, size)
          const decoded = decodeBuffer(buf)
          resolve({
            path: remotePath,
            content: decoded.content,
            encoding: decoded.encoding,
            truncated,
            byteLength: buf.byteLength,
          })
        })
      })
    })
  }

  writeFile(remotePath: string, data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.sftp((error, sftp) => {
        if (error) {
          reject(error)
          return
        }
        const stream = sftp.createWriteStream(remotePath)
        stream.on('error', reject)
        stream.on('close', () => resolve())
        stream.end(data)
      })
    })
  }

  end(): Promise<void> {
    return new Promise((resolve) => {
      this.client.on('close', () => resolve())
      this.client.end()
    })
  }
}

class CappedBuffer {
  truncated = false
  private chunks: Buffer[] = []
  private size = 0

  constructor(private readonly maxBytes: number) {}

  push(chunk: Buffer): void {
    if (this.size >= this.maxBytes) {
      this.truncated = true
      return
    }
    const room = this.maxBytes - this.size
    if (chunk.length > room) {
      this.chunks.push(chunk.subarray(0, room))
      this.size += room
      this.truncated = true
      return
    }
    this.chunks.push(chunk)
    this.size += chunk.length
  }

  toString(): string {
    return Buffer.concat(this.chunks, this.size).toString('utf8')
  }
}

function decodeBuffer(buf: Buffer): { content: string; encoding: 'utf8' | 'base64' } {
  if (buf.includes(0)) {
    return { content: buf.toString('base64'), encoding: 'base64' }
  }
  return { content: buf.toString('utf8'), encoding: 'utf8' }
}
