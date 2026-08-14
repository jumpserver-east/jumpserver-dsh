import { describe, expect, it } from 'vitest'
import { isUnsupportedConnectMethod, nativeConnectMethods } from '../src/connect-method.js'
import { JumpServerError } from '../src/types.js'

describe('nativeConnectMethods', () => {
  it('maps ssh protocol to JumpServer native client methods, not ssh', () => {
    expect(nativeConnectMethods('ssh')).toEqual(['ssh_client', 'ssh_guide'])
    expect(nativeConnectMethods('SSH')).toEqual(['ssh_client', 'ssh_guide'])
  })

  it('maps sftp to sftp_client', () => {
    expect(nativeConnectMethods('sftp')).toEqual(['sftp_client'])
  })
})

describe('isUnsupportedConnectMethod', () => {
  it('matches the Core client-url 400 seen in session logs', () => {
    const error = new JumpServerError(
      'JumpServer GET /api/v1/authentication/connection-token/x/client-url/ failed (400): Connect method not support: ssh',
      400,
      { error: 'Connect method not support: ssh' },
    )
    expect(isUnsupportedConnectMethod(error)).toBe(true)
  })

  it('ignores other failures', () => {
    expect(isUnsupportedConnectMethod(new JumpServerError('账号未找到', 400))).toBe(false)
    expect(isUnsupportedConnectMethod(new Error('Connect method not support: ssh'))).toBe(false)
  })
})
