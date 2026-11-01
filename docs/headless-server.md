# 无头服务端

Pine 可以不开窗口运行在服务器上，只提供远程控制的浏览器界面。它与桌面端是同一套应用核心（`apps/desktop/src/main/core`），区别只在宿主能力：没有窗口、系统通知、快速输入框、自动更新和 computer-use。

## 构建与运行

需要 Node.js 22.13 或更高版本（会话索引使用 `node:sqlite`），以及仓库安装好的依赖。

```sh
bun install --frozen-lockfile
bun run build:server
PINE_PASSWORD='至少 8 个字符' node apps/desktop/.vite/server/server.mjs
```

构建产物在 `apps/desktop/.vite/server/`：`server.mjs`、agent worker（`agent.mjs` 及其分块）和浏览器界面（`renderer/`）。Pi 等运行时依赖从仓库的 `node_modules` 加载，所以要在仓库目录内运行，或把仓库连同依赖一起部署。

`node apps/desktop/.vite/server/server.mjs --help` 列出全部选项：

| 选项 | 环境变量 | 默认值 |
| --- | --- | --- |
| `--data-dir` | `PINE_DATA_DIR` | `$XDG_DATA_HOME/pine-server`（`~/.local/share/pine-server`） |
| `--port` | `PINE_PORT` | `9415` |
| `--lan` | `PINE_LAN=1` | 只监听 `127.0.0.1` |
| `--public-origin` | `PINE_PUBLIC_ORIGIN` | 无 |
| `--remember-for` | `PINE_REMEMBER_FOR` | `7d` |
| `--password-file` | `PINE_PASSWORD_FILE` / `PINE_PASSWORD` | 无，必须提供 |
| `--no-password` | `PINE_REQUIRE_PASSWORD=0` | 需要密码 |

- 密码只从环境变量或文件读取，不接受命令行参数，避免出现在进程列表里。启动时密码未变则保留已登录的浏览器；换了密码会让所有浏览器重新登录。
- `--no-password` 只用于前面已有登录网关（如 Cloudflare Access）且只监听本机的情况，不能与 `--lan` 同时使用。
- 收到 `SIGTERM` / `SIGINT` 时先停止 agent 和它的工具再退出，再次收到信号则立即退出。

## 部署建议

推荐只监听本机，前面放一个终止 TLS 的反向代理，并把 `--public-origin` 设成代理的公网地址：

```ini
# /etc/systemd/system/pine.service
[Unit]
Description=Pine
After=network-online.target

[Service]
User=pine
WorkingDirectory=/opt/pine
Environment=PINE_PUBLIC_ORIGIN=https://pine.example.com
Environment=PINE_PASSWORD_FILE=/etc/pine/password
ExecStart=/usr/bin/node apps/desktop/.vite/server/server.mjs
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## 与桌面端的差异

- 数据目录与桌面端分开，默认不共享项目和会话；可以用 `--data-dir` 指向任意目录，但不要让桌面端和服务端同时使用同一个目录。
- 数据目录以 `0700` 创建。服务器没有系统钥匙串，TinyFish 密钥和模型服务密钥一样以仅本用户可读的文件保存。
- 项目文件夹是服务器上的路径。在浏览器里移到废纸篓的文件会移入数据目录下的 `trash/`，不会被删除。
- 近似位置按服务器的公网 IP 估算，在云主机上通常是机房所在地；需要时可在设置里关闭。
- 已在 macOS 上实测。Linux 上 agent 工具的沙箱依赖 `bubblewrap`，尚未实测。Windows 不支持，因为它的沙箱需要桌面端的一次性提权配置。
- 服务端是单用户的：所有登录的浏览器共享同一组项目、会话和设置。

## 代码结构

```text
src/main/core/pineCore.ts   应用核心：项目、会话、agent 事件、浏览器服务
src/main/core/requests/     按领域注册的共享请求处理器
src/main/core/host.ts       宿主需要提供的平台能力（PineHost）
src/main.ts + main/desktop/ Electron 宿主：窗口、通知、快速输入框、原生对话框
src/server.ts + server/     Node 宿主：参数、fork 出的 agent、文件凭据
```

`vite.server.config.ts` 构建服务端时禁止引入 `electron`，桌面代码误入核心会直接让构建失败。
