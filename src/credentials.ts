import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { DEFAULT_ENABLE_ASSET_ADMIN_ENV, DEFAULT_ORG_ID, DEFAULT_ORG_ID_ENV, type ResolvedConfig } from './config.js'
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

/** Organization UUID: config wins, then JUMPSERVER_ORG_ID, then JumpServer Default org. */
export function resolveOrgId(config: ResolvedConfig): string {
  const fromConfig = config.orgId?.trim()
  const fromEnv = process.env[DEFAULT_ORG_ID_ENV]?.trim()
  return fromConfig || fromEnv || DEFAULT_ORG_ID
}

/** Asset-admin tools: config wins, then JUMPSERVER_ENABLE_ASSET_ADMIN, then false. */
export function resolveEnableAssetAdmin(config: ResolvedConfig): boolean {
  if (typeof config.enableAssetAdmin === 'boolean') return config.enableAssetAdmin
  return parseEnvBoolean(process.env[DEFAULT_ENABLE_ASSET_ADMIN_ENV]) ?? false
}

/** Parse a .env boolean. Empty or unset is undefined so callers can apply their own default. */
export function parseEnvBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized.length === 0) return undefined
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false
  throw new JumpServerError(
    `${DEFAULT_ENABLE_ASSET_ADMIN_ENV} must be true or false, got ${JSON.stringify(value)}.`,
  )
}
