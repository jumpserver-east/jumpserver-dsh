/**
 * DeepSeek Harness plugin: manage JumpServer assets and operate on them through KoKo.
 * @module dsh-jumpserver
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { JumpServerApi } from './api.js'
import { JumpServerClient } from './client.js'
import {
  DEFAULT_ACCESS_KEY_ID_ENV,
  DEFAULT_ACCESS_KEY_SECRET_ENV,
  DEFAULT_ORG_ID,
  DEFAULT_TOKEN_ENV,
  type Config as PluginConfig,
  type ResolvedConfig,
} from './config.js'
import { resolveAuth, resolveBaseUrl } from './credentials.js'
import { registerPrompt } from './prompt.js'
import { SessionManager } from './sessions.js'
import { registerAdminTools, registerCatalogTools } from './tools-catalog.js'
import { registerRuntimeTools } from './tools-runtime.js'

export const name = 'jumpserver'
export const inject = ['tools']

export type Config = PluginConfig

export const Config: z<PluginConfig> = z.object({
  baseUrl: z.string(),
  orgId: z.string().default(DEFAULT_ORG_ID),
  authMode: z.union(['access-key', 'private-token', 'bearer']).default('access-key'),
  accessKeyIdEnv: z.string().role('credential-ref').default(DEFAULT_ACCESS_KEY_ID_ENV),
  accessKeySecretEnv: z.string().role('credential-ref').default(DEFAULT_ACCESS_KEY_SECRET_ENV),
  tokenEnv: z.string().role('credential-ref').default(DEFAULT_TOKEN_ENV),
  kokoHost: z.string(),
  kokoPort: z.number().step(1).min(1).max(65535),
  connectMethod: z.string().default('ssh'),
  protocol: z.string().default('ssh'),
  tlsRejectUnauthorized: z.boolean().default(true),
  enableAssetAdmin: z.boolean().default(false),
  idleTimeoutMs: z.number().step(1).min(1_000).default(600_000),
  execTimeoutMs: z.number().step(1).min(1_000).default(120_000),
  outputMaxBytes: z.number().step(1).min(1024).default(512_000),
  writeMaxBytes: z.number().step(1).min(1024).default(1_048_576),
})

/** Mount JumpServer tools, prompt guidance, and KoKo session cleanup. */
export function apply(ctx: Context, config: PluginConfig): void {
  const resolved = {
    ...(config as ResolvedConfig),
    kokoHost: config.kokoHost?.trim() || process.env.JUMPSERVER_KOKO_HOST?.trim(),
    kokoPort: config.kokoPort ?? parsePort(process.env.JUMPSERVER_KOKO_PORT),
  }
  const client = new JumpServerClient({
    baseUrl: () => resolveBaseUrl(resolved),
    orgId: resolved.orgId,
    tlsRejectUnauthorized: resolved.tlsRejectUnauthorized,
    auth: () => resolveAuth(ctx, resolved),
  })
  const api = new JumpServerApi(client)
  const sessions = new SessionManager({
    idleTimeoutMs: resolved.idleTimeoutMs,
    execTimeoutMs: resolved.execTimeoutMs,
    outputMaxBytes: resolved.outputMaxBytes,
    writeMaxBytes: resolved.writeMaxBytes,
  })

  ctx.effect(() => () => {
    void sessions.disposeAll()
  })

  registerPrompt(ctx, resolved)
  registerCatalogTools(ctx, api)
  registerRuntimeTools(ctx, api, sessions, resolved)
  if (resolved.enableAssetAdmin) registerAdminTools(ctx, api)
}

function parsePort(value: string | undefined): number | undefined {
  if (!value) return undefined
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined
}

export { JumpServerApi } from './api.js'
export { JumpServerClient, buildRequestUrl, signingPath } from './client.js'
export { signAccessKey, buildSigningString, httpDate } from './auth.js'
export { parseJmsUrl, parseClientUrlPayload } from './jms-url.js'
export { SessionManager } from './sessions.js'
export { JumpServerError } from './types.js'
