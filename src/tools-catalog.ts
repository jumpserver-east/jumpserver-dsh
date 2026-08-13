import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JumpServerApi } from './api.js'
import { jsonOutput } from './render.js'

function asJson(value: unknown): JsonValue {
  return value as JsonValue
}

/** Register read-only asset / account / node / profile tools. */
export function registerCatalogTools(ctx: Context, api: JumpServerApi): void {
  ctx.tools.register(defineTool({
    name: 'jms_whoami',
    description: 'Show the JumpServer user profile for the configured credentials. Use this to verify authentication and the current organization.',
    parameters: {},
    output: jsonOutput,
    isConcurrencySafe: () => true,
    presentCall: () => ({ card: 'generic', title: 'JumpServer whoami', kind: 'fetch' }),
    async execute(_args, exec) {
      return asJson(await api.profile(exec.signal))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'jms_list_assets',
    description: 'List JumpServer assets the current user is permitted to access. Prefer this over guessing hostnames. Results are permission-filtered by JumpServer.',
    parameters: {
      search: { type: 'string', description: 'Optional name/address search string' },
      name: { type: 'string', description: 'Optional exact-ish name filter' },
      address: { type: 'string', description: 'Optional address filter' },
      type: { type: 'string', description: 'Optional asset type, for example host' },
      limit: { type: 'integer', description: 'Page size (default 50)' },
      offset: { type: 'integer', description: 'Page offset (default 0)' },
    },
    output: jsonOutput,
    isConcurrencySafe: () => true,
    presentCall: args => ({
      card: 'generic',
      title: args.search ? `List JumpServer assets: ${args.search}` : 'List JumpServer assets',
      kind: 'search',
      rawInput: args.search ?? args.name ?? args.address,
    }),
    async execute(args, exec) {
      return asJson(await api.listAssets({
        search: args.search,
        name: args.name,
        address: args.address,
        type: args.type,
        limit: args.limit,
        offset: args.offset,
      }, exec.signal))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'jms_get_asset',
    description: 'Get one JumpServer asset by id, including protocols and platform when the API returns them.',
    parameters: {
      asset_id: { type: 'string', required: true, description: 'Asset UUID' },
    },
    output: jsonOutput,
    isConcurrencySafe: () => true,
    presentCall: args => ({ card: 'generic', title: `Get asset ${args.asset_id}`, kind: 'read' }),
    async execute(args, exec) {
      if (!args.asset_id.trim()) throw new Error('asset_id must be non-empty')
      return asJson(await api.getAsset(args.asset_id.trim(), exec.signal))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'jms_list_accounts',
    description: 'List JumpServer accounts the current user may use on an asset. Pass an account name or id to jms_connect.',
    parameters: {
      asset_id: { type: 'string', required: true, description: 'Asset UUID' },
    },
    output: jsonOutput,
    isConcurrencySafe: () => true,
    presentCall: args => ({ card: 'generic', title: `List accounts on ${args.asset_id}`, kind: 'search' }),
    async execute(args, exec) {
      if (!args.asset_id.trim()) throw new Error('asset_id must be non-empty')
      return asJson(await api.listAccounts(args.asset_id.trim(), exec.signal))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'jms_list_nodes',
    description: 'List JumpServer nodes (asset tree). Needed when creating hosts into a node.',
    parameters: {},
    output: jsonOutput,
    isConcurrencySafe: () => true,
    presentCall: () => ({ card: 'generic', title: 'List JumpServer nodes', kind: 'search' }),
    async execute(_args, exec) {
      return asJson(await api.listNodes(exec.signal))
    },
  }))
}

/** Register optional admin CRUD tools. */
export function registerAdminTools(ctx: Context, api: JumpServerApi): void {
  ctx.tools.register(defineTool({
    name: 'jms_list_platforms',
    description: 'List JumpServer host platforms. Use a platform pk when creating a host.',
    parameters: {},
    output: jsonOutput,
    isConcurrencySafe: () => true,
    presentCall: () => ({ card: 'generic', title: 'List JumpServer platforms', kind: 'search' }),
    async execute(_args, exec) {
      return asJson(await api.listPlatforms(exec.signal))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'jms_create_host',
    description: 'Create a JumpServer host asset. Requires asset admin permission. Connections still go through JumpServer/KoKo; this only registers the asset.',
    parameters: {
      name: { type: 'string', required: true, description: 'Asset name' },
      address: { type: 'string', required: true, description: 'IP or hostname' },
      platform: { type: 'string', required: true, description: 'Platform pk (number as string) or platform object id' },
      node_id: { type: 'string', required: true, description: 'Node UUID to place the host under' },
      comment: { type: 'string', description: 'Optional comment' },
      ssh_port: { type: 'integer', description: 'SSH/SFTP port, default 22' },
    },
    output: jsonOutput,
    presentCall: args => ({ card: 'generic', title: `Create host ${args.name}`, kind: 'edit', rawInput: args.address }),
    async execute(args, exec) {
      const port = args.ssh_port ?? 22
      const platform = /^\d+$/.test(args.platform) ? Number(args.platform) : args.platform
      return asJson(await api.createHost({
        name: args.name,
        address: args.address,
        platform,
        nodes: [args.node_id],
        comment: args.comment,
        protocols: [
          { name: 'ssh', port },
          { name: 'sftp', port },
        ],
      }, exec.signal))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'jms_update_host',
    description: 'Patch a JumpServer host. Only send fields that should change. Requires asset admin permission.',
    parameters: {
      host_id: { type: 'string', required: true, description: 'Host UUID' },
      name: { type: 'string', description: 'New name' },
      address: { type: 'string', description: 'New address' },
      comment: { type: 'string', description: 'New comment' },
      is_active: { type: 'boolean', description: 'Enable or disable the host' },
    },
    output: jsonOutput,
    presentCall: args => ({ card: 'generic', title: `Update host ${args.host_id}`, kind: 'edit' }),
    async execute(args, exec) {
      const patch: Record<string, unknown> = {}
      if (args.name !== undefined) patch.name = args.name
      if (args.address !== undefined) patch.address = args.address
      if (args.comment !== undefined) patch.comment = args.comment
      if (args.is_active !== undefined) patch.is_active = args.is_active
      if (Object.keys(patch).length === 0) throw new Error('no fields to update')
      return asJson(await api.updateHost(args.host_id, patch, exec.signal))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'jms_delete_host',
    description: 'Delete a JumpServer host asset. Requires asset admin permission. This removes the asset from JumpServer, not files on the machine.',
    parameters: {
      host_id: { type: 'string', required: true, description: 'Host UUID' },
    },
    output: jsonOutput,
    presentCall: args => ({ card: 'generic', title: `Delete host ${args.host_id}`, kind: 'delete' }),
    async execute(args, exec) {
      await api.deleteHost(args.host_id, exec.signal)
      return { deleted: true, host_id: args.host_id }
    },
  }))
}
