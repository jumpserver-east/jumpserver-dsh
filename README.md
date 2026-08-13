# dsh-jumpserver

DeepSeek Harness plugin that manages [JumpServer](https://github.com/jumpserver/jumpserver) assets and lets the agent operate on them **through KoKo**. Traffic never bypasses the bastion: command filters, ACL, and session recording still apply.

Requires [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) `>= 0.1.0-rc.6` (developer preview; APIs may change).

## Install

From a machine that already runs `dsh`:

```sh
# local checkout
cd jumpserver-dsh
pnpm install
pnpm build
dsh plugin --profile web add .

# or from GitHub (pnpm >= 10 must allow the prepare/build script)
dsh plugin --profile web add github:jumpserver-east/jumpserver-dsh
```

If a git install refuses `prepare`, copy the package key pnpm printed into the profile `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-jumpserver: true
```

then re-run `dsh plugin add`. Pin a commit (`github:jumpserver-east/jumpserver-dsh#<sha>`) so a later push cannot change what runs.

Override config in the profile `cordis.patch.yml` if needed:

```yaml
- update:
    - id: jumpserver
      name: dsh-jumpserver
      config:
        baseUrl: https://jms.example.com
        orgId: 00000000-0000-0000-0000-000000000002
        enableAssetAdmin: false
```

## Credentials

Do not put secrets in `cordis.yml`. Use Harness credentials / environment variables:

| Variable | Purpose |
|---|---|
| `JUMPSERVER_URL` | Core URL, for example `https://jms.example.com` |
| `JUMPSERVER_ORG_ID` | Organization UUID (`X-JMS-ORG`). Default org is `00000000-0000-0000-0000-000000000002` |
| `JUMPSERVER_ACCESS_KEY_ID` | Access Key ID (preferred) |
| `JUMPSERVER_ACCESS_KEY_SECRET` | Access Key secret |
| `JUMPSERVER_TOKEN` | Private Token or Bearer token when `authMode` is `private-token` / `bearer` |
| `JUMPSERVER_KOKO_HOST` / `JUMPSERVER_KOKO_PORT` | Optional KoKo SSH override |

Create an Access Key in JumpServer personal settings. The running Harness host must be able to reach both Core (`https`) and KoKo SSH (default port `2222`).

Copy `.env.example` and load those names through Harness credentials (or the process environment).

## Tools

Always available:

- `jms_whoami` — verify the API user
- `jms_list_assets` / `jms_get_asset` / `jms_list_accounts` / `jms_list_nodes`
- `jms_connect` — connection token + KoKo SSH (`JMS-<token-id>`)
- `jms_exec` — command on the asset (audited)
- `jms_read_file` / `jms_write_file` — SFTP through KoKo
- `jms_list_sessions` / `jms_disconnect`

When `enableAssetAdmin: true`:

- `jms_list_platforms` / `jms_create_host` / `jms_update_host` / `jms_delete_host`

Typical flow: list assets → list accounts → connect → exec → disconnect.

SSH-only in this version. RDP / database protocols are out of scope.

## Development

```sh
pnpm install
pnpm test
pnpm build
```

## License

MIT.
