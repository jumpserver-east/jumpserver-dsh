# dsh-jumpserver

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：让 agent 通过 [JumpServer](https://github.com/jumpserver/jumpserver) 管理资产，并**经 KoKo 堡垒**在资产上执行命令 / 读写文件。流量不直连资产 IP，命令过滤、ACL、会话审计仍然生效。

本版本只支持 **SSH / SFTP**。RDP、数据库等协议不在范围内。

## 兼容版本

插件调用 JumpServer **Core REST API v1**（Access Key 签名、用户资产授权、connection-token、`client-url`、主机资产 CRUD）。Core 与 KoKo 须为**同一发行版本**。

| 产品 | 支持的版本 |
|---|---|
| JumpServer | **v3.10 LTS**（v3.10.0 ～ 当前 v3.10.22）、**v4.10 LTS**（v4.10.0 ～ 当前 v4.10.18） |
| DeepSeek Harness | `>= 0.1.0-rc.6`（开发预览，接口可能变化） |

## 安装

本机已安装 `dsh` 后，优先从 GitHub 安装：

```sh
dsh plugin --profile web add github:jumpserver-east/jumpserver-dsh
```

pnpm >= 10 可能拒绝执行 git 依赖的 `prepare`。把 pnpm 打印的包名写进该 profile 的 `pnpm-workspace.yaml`：

```yaml
allowBuilds:
  dsh-jumpserver: true
```

然后重新执行 `dsh plugin add`。可以用 `github:jumpserver-east/jumpserver-dsh#<sha>` 钉死提交。

从本地仓库安装：

```sh
cd jumpserver-dsh
pnpm install
pnpm build
dsh plugin --profile web add .
```

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
```

Access Key 在 JumpServer「个人设置」里创建。跑 dsh 的这台机器要能连上 JumpServer Core（HTTPS）和 KoKo SSH；KoKo 的地址和端口会从 connection-token 自动带出，不用单独填。

- `JUMPSERVER_ORG_ID` 不写则使用 JumpServer 的 Default 组织。换组织改这一行后重启 dsh 即可。
- `JUMPSERVER_ENABLE_ASSET_ADMIN` 默认 `false`：只能列出、连接该 Access Key 已有权限的资产。设为 `true` 会额外注册创建 / 更新 / 删除主机的工具（`jms_list_platforms`、`jms_create_host`、`jms_update_host`、`jms_delete_host`）。请求仍走 Core RBAC，也不会绕过 KoKo。没有主机管理权限时保持 `false`。

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
```

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
- `jms_connect` — 创建 connection-token，经 KoKo SSH 建会话（用户名 `JMS-<token-id>`）
- `jms_exec` — 在资产上执行命令（可审计）
- `jms_read_file` / `jms_write_file` — 经 KoKo 做 SFTP
- `jms_list_sessions` / `jms_disconnect`

`JUMPSERVER_ENABLE_ASSET_ADMIN=true` 时额外提供：

- `jms_list_platforms` / `jms_create_host` / `jms_update_host` / `jms_delete_host`

典型顺序：列出资产 → 列出账号 → 连接 → 执行 → 断开。

## 开发

```sh
pnpm install
pnpm test
pnpm build
```

## License

MIT.
