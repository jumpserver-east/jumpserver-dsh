import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Tool-guidance section so the model prefers JumpServer over direct SSH. */
export const JUMPSERVER_PROMPT = `JumpServer tools (jms_*):
- Discover assets with jms_list_assets / jms_get_asset / jms_list_accounts. Do not invent asset ids. Use category=database (or type=mysql / postgresql / redis) when looking for databases.
- To operate on a machine, jms_connect then jms_exec (and jms_read_file / jms_write_file). Never SSH or SFTP to the asset address directly; traffic must go through JumpServer KoKo so audit, ACL, and command filters apply.
- To operate on a database, jms_connect (omit protocol to auto-detect mysql/postgresql/redis/...) then jms_sql. Queries (SELECT/SHOW/DESCRIBE/EXPLAIN) are always allowed. INSERT/UPDATE/DELETE and other mutations are rejected unless JUMPSERVER_ENABLE_DB_WRITE is on. Do not bypass this with jms_exec.
- jms_connect returns session_id. Reuse it for multiple commands, then jms_disconnect.
- Command denials from JumpServer are expected when filters block a command; report the denial instead of bypassing the bastion.
- Admin tools (create/update/delete host) only exist when enableAssetAdmin is on, and they still do not grant a backdoor around KoKo.`

/** Register a system-prompt section once that service is available. */
export function registerPrompt(ctx: Context): void {
  ctx.inject(['systemPrompt'], (inner) => {
    inner.systemPrompt.section({
      name: 'jumpserver',
      order: 150,
      text: JUMPSERVER_PROMPT,
    })
  })
}
