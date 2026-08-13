/** JumpServer Default organization id. */
export const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000002'

/** Credential reference for Access Key ID. */
export const DEFAULT_ACCESS_KEY_ID_ENV = 'JUMPSERVER_ACCESS_KEY_ID'

/** Credential reference for Access Key secret. */
export const DEFAULT_ACCESS_KEY_SECRET_ENV = 'JUMPSERVER_ACCESS_KEY_SECRET'

/** Credential reference for Private Token or Bearer token. */
export const DEFAULT_TOKEN_ENV = 'JUMPSERVER_TOKEN'

/** How the plugin authenticates to JumpServer Core. */
export type AuthMode = 'access-key' | 'private-token' | 'bearer'

/** Plugin configuration supplied through cordis.yml / settings. */
export interface Config {
  /** JumpServer Core base URL, for example `https://jms.example.com`. */
  baseUrl?: string
  /** Organization UUID sent as `X-JMS-ORG`. */
  orgId?: string
  /** Authentication scheme. Defaults to Access Key HMAC signatures. */
  authMode?: AuthMode
  /** Credential reference for Access Key ID. */
  accessKeyIdEnv?: string
  /** Credential reference for Access Key secret. */
  accessKeySecretEnv?: string
  /** Credential reference for Private Token or Bearer token. */
  tokenEnv?: string
  /** Override KoKo SSH host. When omitted, client-url endpoint.host is used. */
  kokoHost?: string
  /** Override KoKo SSH port. When omitted, client-url endpoint.port is used (typically 2222). */
  kokoPort?: number
  /** JumpServer connect method stored on the connection token. */
  connectMethod?: string
  /** Default protocol when connecting. */
  protocol?: string
  /** Reject TLS certificates that fail verification. */
  tlsRejectUnauthorized?: boolean
  /** Register host create/update/delete tools. */
  enableAssetAdmin?: boolean
  /** Close idle KoKo SSH sessions after this many milliseconds. */
  idleTimeoutMs?: number
  /** Cooperative timeout for one remote command. */
  execTimeoutMs?: number
  /** Cap on captured command / file output. */
  outputMaxBytes?: number
  /** Cap on a single SFTP write. */
  writeMaxBytes?: number
}

/** Config after schema defaults are applied. */
export type ResolvedConfig = Required<
  Pick<
    Config,
    | 'orgId'
    | 'authMode'
    | 'accessKeyIdEnv'
    | 'accessKeySecretEnv'
    | 'tokenEnv'
    | 'connectMethod'
    | 'protocol'
    | 'tlsRejectUnauthorized'
    | 'enableAssetAdmin'
    | 'idleTimeoutMs'
    | 'execTimeoutMs'
    | 'outputMaxBytes'
    | 'writeMaxBytes'
  >
> & Config
