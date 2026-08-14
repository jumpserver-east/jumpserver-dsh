# dsh-jumpserver

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：让 agent 通过 [JumpServer](https://github.com/jumpserver/jumpserver) 管理资产，并**经 KoKo 堡垒**在资产上执行命令 / 读写文件。流量不直连资产 IP，命令过滤、ACL、会话审计仍然生效。

本版本支持 **SSH / SFTP** 主机，以及经 KoKo 的 **数据库**（MySQL、MariaDB、PostgreSQL、Redis、MongoDB、Oracle、SQL Server 等）。RDP / 图形协议不在范围内。未授权时数据库会话只能查询；INSERT / UPDATE / DELETE 等写操作需要显式打开 `JUMPSERVER_ENABLE_DB_WRITE`。

## 兼容版本

插件调用 JumpServer **Core REST API v1**（Access Key 签名、用户资产授权、connection-token、`client-url`、主机资产 CRUD）。Core 与 KoKo 须为**同一发行版本**。

| 产品 | 支持的版本 |
|---|---|
| JumpServer | **v3.10 LTS**（v3.10.0 ～ 当前 v3.10.22）、**v4.10 LTS**（v4.10.0 ～ 当前 v4.10.18） |
| DeepSeek Harness | `>= 0.1.0-rc.6`（开发预览，接口可能变化） |

## 安装

`dsh plugin` 会把命令转给 `pnpm`，在目标 profile 目录里装包。本机需要 Node.js、[pnpm](https://pnpm.io)（macOS 可用 `brew install pnpm`），以及 DeepSeek Harness CLI。

`dsh` 不是系统自带命令。没装过全局包时用：

```sh
npx @deepseek-ai/dsh <子命令>
```

也可以 `npm install -g @deepseek-ai/dsh`，之后直接打 `dsh`。不要用 Homebrew 的 `dsh` 配方，那是另一个 Unix 工具。

下面命令里的 `dsh` 都可以换成 `npx @deepseek-ai/dsh`。web profile 的配置在 `~/.dsh/profiles/web/`（Windows 为 `%USERPROFILE%\.dsh\profiles\web\`）。

### 从 GitHub 安装

```sh
dsh plugin --profile web add github:jumpserver-east/jumpserver-dsh
```

pnpm 会把仓库拉到临时目录，先跑插件自己的 `pnpm install`，再执行 `prepare`（`tsc`）。实测会依次碰到两道拦：

1. **构建授权**  
   报 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`。把 pnpm 打印的 key 写进该 profile 的 `pnpm-workspace.yaml` 后重跑：

```yaml
allowBuilds:
  dsh-jumpserver: true
```

   若打印的是带 tarball URL 的长 key，按它原样加一行。

2. **包太新**  
   报 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`。pnpm 11 默认拒绝 lockfile 里发布时间不足约 24 小时的包。DeepSeek Harness 刚发 rc 时，`@deepseek-ai/*` 很容易踩中。  
   可以等过截止时间再装，或在该 profile 的 `pnpm-workspace.yaml` 里临时加 `minimumReleaseAge: 0` 后重试。也可以改走下面的本地安装——本地 `link:` 不会在临时目录里按插件 lockfile 再装一遍。

可以用 `github:jumpserver-east/jumpserver-dsh#<sha>` 钉死提交。

### 从本地仓库安装

适合改插件，或 GitHub 安装被年龄检查拦住时。

```sh
cd jumpserver-dsh
pnpm install --config.minimum-release-age=0
pnpm build
dsh plugin --profile web add .
```

`--config.minimum-release-age=0` 只在本仓库 `pnpm install` 也触发同样检查时需要；包够老了可以去掉。`add .` 必须在仓库目录执行（`.` 相对的是当前工作目录，不是 profile 目录）。

成功后 profile 的 `package.json` 应类似：

```json
{
  "dependencies": {
    "dsh-jumpserver": "link:/绝对路径/jumpserver-dsh"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-jumpserver"
      ]
    }
  }
}
```

`dsh plugin add` 会自己核对 `bundles`。若命令很慢或中途失败，可以在 profile 目录直接 link，再把 `dsh-jumpserver` 写进 `dsh.profile.bundles`：

```sh
cd ~/.dsh/profiles/web
pnpm add /绝对路径/jumpserver-dsh
```

改本地代码后执行 `pnpm build`，再重启 dsh。

profile 的 `pnpm-workspace.yaml` 建议至少有：

```yaml
allowBuilds:
  dsh-jumpserver: true
```

若 pnpm 提示忽略了 `ssh2` 的构建脚本，再加上 `ssh2: true`（以及它依赖的 `cpu-features`）。

## 配置

dsh 的「插件配置」页**不会**根据插件 `Config` 自动出表单，目前只展示 Host 白名单里的官方卡片（Shell、Agent loop、Web search）。第三方插件进不了这一页，所以 **JumpServer 没有设置页**。装好后新建下面的 `.env`，再重启 `dsh`。

### 需配置 — `$DSH_HOME/.env`

dsh 主目录默认为：

- macOS / Linux：`~/.dsh`
- Windows：`%USERPROFILE%\.dsh`

在该目录新建 `.env`（安装插件时不会自动生成，可对照本仓库的 `.env.example`）：

```dotenv
JUMPSERVER_URL=https://jms.example.com
JUMPSERVER_ORG_ID=00000000-0000-0000-0000-000000000002
JUMPSERVER_ACCESS_KEY_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
JUMPSERVER_ACCESS_KEY_SECRET=********************************
JUMPSERVER_ENABLE_ASSET_ADMIN=false
JUMPSERVER_ENABLE_DB_WRITE=false
```

Access Key 在 JumpServer「个人设置」里创建。跑 dsh 的这台机器要能连上 JumpServer Core（HTTPS）和 KoKo SSH；KoKo 的地址和端口会从 connection-token 自动带出，不用单独填。

- `JUMPSERVER_ORG_ID` 不写则使用 JumpServer 的 Default 组织。换组织改这一行后重启 dsh 即可。
- `JUMPSERVER_ENABLE_ASSET_ADMIN` 默认 `false`：只能列出、连接该 Access Key 已有权限的资产。设为 `true` 会额外注册创建 / 更新 / 删除主机的工具（`jms_list_platforms`、`jms_create_host`、`jms_update_host`、`jms_delete_host`）。请求仍走 Core RBAC，也不会绕过 KoKo。没有主机管理权限时保持 `false`。
- `JUMPSERVER_ENABLE_DB_WRITE` 默认 `false`：数据库会话只允许查询（`SELECT` / `SHOW` / `DESCRIBE` / `EXPLAIN` 以及 Redis 读命令等）。设为 `true` 才允许 `INSERT` / `UPDATE` / `DELETE` 等写语句。JumpServer 自己的命令过滤仍然生效。没有写库授权时保持 `false`。

密钥也可以放进 `$DSH_HOME/.credentials.yaml`，变量名相同。JumpServer 地址写在 `.env` 的 `JUMPSERVER_URL` 即可，也可以写在下一节 `cordis.patch.yml` 的 `baseUrl`。

### 可选 — `cordis.patch.yml`

只有在需要用 `baseUrl` 覆盖 `JUMPSERVER_URL` 时，才改这个文件：

- macOS / Linux：`~/.dsh/profiles/web/cordis.patch.yml`
- Windows：`%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`

```yaml
- update:
    - id: jumpserver
      name: dsh-jumpserver
      config:
        baseUrl: https://jms.example.com
        tlsRejectUnauthorized: true
```

`tlsRejectUnauthorized` 默认 `false`（内网自签证书可连）。设为 `true` 时按系统 CA 校验 Core 的 HTTPS 证书。

## 使用

写好 `.env` 后重启 web profile：

```sh
dsh --profile web
```

在对话里用自然语言即可，不必写工具名，例如：

```
查看我当前 JumpServer 可连接的资产有哪些
```

或：

```
先确认 JumpServer 登录，再列出我能连的资产；连上 xxx 执行 hostname，然后断开。
```

agent 会按需调用 `jms_*` 工具。不要让它直接 SSH 资产 IP。

## 工具

默认可用：

- `jms_whoami` — 确认当前 API 用户
- `jms_list_assets` / `jms_get_asset` / `jms_list_accounts` / `jms_list_nodes`
- `jms_connect` — 创建 connection-token，经 KoKo 建会话（用户名 `JMS-<token-id>`）。主机默认 SSH；数据库资产可省略 protocol，或显式传 `mysql` / `postgresql` / `redis` 等
- `jms_exec` — 在主机上执行命令（可审计）。数据库会话上的写语句同样受 `JUMPSERVER_ENABLE_DB_WRITE` 约束
- `jms_sql` — 在数据库会话上执行 SQL / Redis / Mongo 命令。未授权只能查询
- `jms_read_file` / `jms_write_file` — 经 KoKo 做 SFTP（仅主机会话）
- `jms_list_sessions` / `jms_disconnect`

`JUMPSERVER_ENABLE_ASSET_ADMIN=true` 时额外提供：

- `jms_list_platforms` / `jms_create_host` / `jms_update_host` / `jms_delete_host`

典型顺序：列出资产 → 列出账号 → 连接 → 执行 / 查库 → 断开。查数据库时用 `jms_list_assets` 加 `category=database`。

## 开发

```sh
pnpm install --config.minimum-release-age=0
pnpm test
pnpm build
```

`--config.minimum-release-age=0` 同上，仅在 pnpm 11 因 `@deepseek-ai/*` 发布时间不足 24 小时拒装时需要。

## License

MIT.
