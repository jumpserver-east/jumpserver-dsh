import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JumpServerApi } from './api.js'
import type { ResolvedConfig } from './config.js'
import { resolveBaseUrl } from './credentials.js'
import { resolveKokoEndpoint } from './koko-endpoint.js'
import { jsonOutput } from './render.js'
import { JumpServerError, type ClientProtocolData, type ConnectionTokenInfo } from './types.js'
import type { SessionManager } from './sessions.js'

const DEFAULT_PROTOCOL = 'ssh'

function asJson(value: unknown): JsonValue {
  return value as JsonValue
}

/** Register connect / exec / SFTP / disconnect tools. */
export function registerRuntimeTools(
  ctx: Context,
  api: JumpServerApi,
  sessions: SessionManager,
  config: ResolvedConfig,
): void {
  ctx.tools.register(defineTool({
    name: 'jms_connect',
    description: 'Create a JumpServer connection token and open an SSH session through KoKo to the asset. Always connect this way; never SSH to the asset address directly. Returns a session_id for jms_exec, jms_read_file, and jms_write_file.',
    parameters: {
      asset_id: { type: 'string', required: true, description: 'Asset UUID' },
      account: { type: 'string', required: true, description: 'Account UUID or username from jms_list_accounts. Do not use a display name when it differs from username.' },
      protocol: { type: 'string', description: 'Protocol, default ssh' },
      input_username: { type: 'string', description: 'Username when the account is @USER or @INPUT' },
    },
    output: jsonOutput,
    timeoutMs: 60_000,
    presentCall: args => ({
      card: 'generic',
      title: `Connect ${args.account}@${args.asset_id}`,
      kind: 'execute',
    }),
    async execute(args, exec) {
      const protocol = args.protocol?.trim() || DEFAULT_PROTOCOL
      const assetId = args.asset_id.trim()
      const resolvedAccount = await api.resolveAccount(assetId, args.account, exec.signal)
      if (resolvedAccount.inputUsernameRequired && !args.input_username?.trim()) {
        throw new JumpServerError('account @USER or @INPUT requires input_username')
      }
      const { token, client } = await api.createClientProtocol({
        asset: assetId,
        account: resolvedAccount.account,
        protocol,
        inputUsername: args.input_username,
      }, exec.signal)
      return await openKokoSession(api, sessions, config, {
        token,
        client,
        assetId,
        account: resolvedAccount.account,
        protocol,
      }, exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'jms_exec',
    description: 'Run a command on an asset through an existing JumpServer/KoKo session. JumpServer command filters and session recording still apply.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'Session id returned by jms_connect' },
      command: { type: 'string', required: true, description: 'Command to run on the asset' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          session_id: { type: 'string', required: true },
          command: { type: 'string', required: true },
          exit_code: { type: 'integer' },
          signal: { type: 'string' },
          stdout: { type: 'string', required: true },
          stderr: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
          timed_out: { type: 'boolean' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: formatExec(value),
      }],
    },
    timeoutMs: config.execTimeoutMs + 5_000,
    presentCall: args => ({
      card: 'terminal',
      title: args.command,
      description: `JumpServer session ${args.session_id}`,
    }),
    presentResult: (args, result) => {
      const text = result.content.map(block => block.type === 'text' ? block.text : '').join('')
      return {
        card: 'terminal',
        title: args.command,
        output: text,
      }
    },
    async execute(args, exec) {
      if (!args.command.trim()) throw new Error('command must be non-empty')
      const result = await sessions.exec(args.session_id, args.command, exec.signal)
      return {
        session_id: result.session_id,
        command: result.command,
        ...(typeof result.exitCode === 'number' ? { exit_code: result.exitCode } : {}),
        ...(result.signal ? { signal: result.signal } : {}),
        stdout: result.stdout,
        stderr: result.stderr,
        truncated: result.truncated,
        ...(result.timedOut ? { timed_out: true } : {}),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'jms_read_file',
    description: 'Read a file from an asset over SFTP through JumpServer/KoKo.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'Session id returned by jms_connect' },
      path: { type: 'string', required: true, description: 'Absolute remote path' },
    },
    output: jsonOutput,
    presentCall: args => ({
      card: 'generic',
      title: `Read ${args.path}`,
      kind: 'read',
      locations: [{ path: args.path }],
    }),
    async execute(args, exec) {
      if (!args.path.trim()) throw new Error('path must be non-empty')
      return asJson(await sessions.readFile(args.session_id, args.path, exec.signal))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'jms_write_file',
    description: 'Write a file on an asset over SFTP through JumpServer/KoKo.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'Session id returned by jms_connect' },
      path: { type: 'string', required: true, description: 'Absolute remote path' },
      content: { type: 'string', required: true, description: 'File contents' },
      encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'Content encoding, default utf8' },
    },
    output: jsonOutput,
    presentCall: args => ({
      card: 'generic',
      title: `Write ${args.path}`,
      kind: 'edit',
      locations: [{ path: args.path }],
    }),
    async execute(args, exec) {
      if (!args.path.trim()) throw new Error('path must be non-empty')
      const encoding = args.encoding === 'base64' ? 'base64' : 'utf8'
      return asJson(await sessions.writeFile(args.session_id, args.path, args.content, encoding, exec.signal))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'jms_list_sessions',
    description: 'List JumpServer/KoKo SSH sessions opened by this plugin in the current Harness process.',
    parameters: {},
    output: jsonOutput,
    isConcurrencySafe: () => true,
    presentCall: () => ({ card: 'generic', title: 'List JumpServer sessions', kind: 'search' }),
    async execute() {
      return asJson({ results: sessions.list() })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'jms_disconnect',
    description: 'Close a JumpServer/KoKo SSH session opened by jms_connect.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'Session id returned by jms_connect' },
    },
    output: jsonOutput,
    presentCall: args => ({ card: 'generic', title: `Disconnect ${args.session_id}`, kind: 'other' }),
    async execute(args, exec) {
      const result = await sessions.disconnect(args.session_id, exec.signal)
      if (result.token_id) await api.expireConnectionToken(result.token_id)
      return result
    },
  }))
}

/**
 * Open KoKo SSH after createClientProtocol. Expire the token if endpoint
 * resolve or SSH fails — that method already popped the id from leftoverIds.
 */
export async function openKokoSession(
  api: Pick<JumpServerApi, 'expireConnectionToken'>,
  sessions: SessionManager,
  config: ResolvedConfig,
  input: {
    token: ConnectionTokenInfo
    client: ClientProtocolData
    assetId: string
    account: string
    protocol: string
  },
  signal?: AbortSignal,
): Promise<JsonValue> {
  try {
    const { host, port } = resolveKokoEndpoint(input.client.endpoint, resolveBaseUrl(config))
    const info = await sessions.open({
      host,
      port,
      username: `JMS-${input.client.token.id}`,
      password: input.client.token.value,
      assetId: input.assetId,
      account: input.account,
      protocol: input.protocol,
      tokenId: input.token.id,
    }, signal)
    return asJson({
      ...info,
      token_id: input.token.id,
      ...(input.token.date_expired ? { date_expired: input.token.date_expired } : {}),
      koko: { host, port },
    })
  } catch (error) {
    await api.expireConnectionToken(input.token.id)
    throw error
  }
}

function formatExec(value: {
  command: string
  stdout: string
  stderr: string
  truncated: boolean
  exit_code?: number
  signal?: string
  timed_out?: boolean
}): string {
  const status = value.timed_out
    ? 'timed out'
    : value.exit_code !== undefined
      ? `exit ${value.exit_code}`
      : value.signal
        ? `signal ${value.signal}`
        : 'unknown status'
  const parts = [`$ ${value.command}`, value.stdout, value.stderr, `[${status}${value.truncated ? ', truncated' : ''}]`]
  return parts.filter(part => part.length > 0).join('\n')
}
