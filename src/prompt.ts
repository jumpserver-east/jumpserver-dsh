import type { Context } from '@deepseek-ai/cordis'

/** Tool-guidance section so the model prefers JumpServer over direct SSH. */
export const JUMPSERVER_PROMPT = `JumpServer tools (jms_*):
- Discover assets with jms_list_assets / jms_get_asset / jms_list_accounts. Do not invent asset ids.
- To operate on a machine, jms_connect then jms_exec (and jms_read_file / jms_write_file). Never SSH or SFTP to the asset address directly; traffic must go through JumpServer KoKo so audit, ACL, and command filters apply.
- jms_connect returns session_id. Reuse it for multiple commands, then jms_disconnect.
- Command denials from JumpServer are expected when filters block a command; report the denial instead of bypassing the bastion.
- Admin tools (create/update/delete host) only exist when enableAssetAdmin is on, and they still do not grant a backdoor around KoKo.`

/** Register a system-prompt section when the seam is present. */
export function registerPrompt(ctx: Context): void {
  const systemPrompt = ctx.get('systemPrompt')
  systemPrompt?.section({
    name: 'jumpserver',
    order: 150,
    text: JUMPSERVER_PROMPT,
  })
}
