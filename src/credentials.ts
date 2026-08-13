import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { ResolvedConfig } from './config.js'
import { JumpServerError, type ResolvedAuth } from './types.js'

/**
 * Resolve JumpServer Access Key credentials for one Core API call.
 * Prefers `ctx.credentials`, then the process environment.
 */
export async function resolveAuth(ctx: Context, config: ResolvedConfig): Promise<ResolvedAuth> {
  const accessKeyId = await readSecret(ctx, config.accessKeyIdEnv)
  const accessKeySecret = await readSecret(ctx, config.accessKeySecretEnv)
  if (!accessKeyId || !accessKeySecret) {
    throw new JumpServerError(
      `JumpServer Access Key is not configured. Set ${config.accessKeyIdEnv} and ${config.accessKeySecretEnv}.`,
    )
  }
  return { accessKeyId, accessKeySecret }
}

/** Read one credential reference without ever logging the value. */
export async function readSecret(ctx: Context, refName: string): Promise<string | undefined> {
  try {
    const ref = credentialRef(refName)
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit?.value) return hit.value
    }
  } catch {
    // Invalid ref names fail the schema at load; here we still allow env fallback.
  }
  const ambient = process.env[refName]
  return ambient !== undefined && ambient.length > 0 ? ambient : undefined
}

/** Core URL: config wins, then JUMPSERVER_URL. */
export function resolveBaseUrl(config: ResolvedConfig): string {
  const fromConfig = config.baseUrl?.trim()
  const fromEnv = process.env.JUMPSERVER_URL?.trim()
  const baseUrl = fromConfig || fromEnv
  if (!baseUrl) {
    throw new JumpServerError('JumpServer URL is not configured. Set config.baseUrl or JUMPSERVER_URL.')
  }
  return baseUrl.replace(/\/+$/, '')
}
