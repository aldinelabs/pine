# 手机远程控制

在 Pine 设置的「远程控制」中开启「手机远程控制」，点击「配对新手机」，用手机相机扫描二维码，在电脑上点「允许」后，手机即可使用这台电脑上的 Pine，无需端口转发、账号或公网地址。手机经[本地网页控制](local-web-control.md)使用 Pine，因此「浏览器访问」也必须开启。

## 组成

```text
手机 rc.aldine.cn ──信令 api.aldine.cn/rc/v1──┐
   │  (Service Worker)                        │
   └──── WebRTC DataChannel（DTLS） ───── 桌面 RemoteHost ── HTTP ──> 本地 web server（127.0.0.1）
```

- `packages/rc-protocol`：二维码格式、设备密钥、签名握手、房间 id、帧格式、信令客户端和 ICE 收集策略，桌面与手机共用。
- `apps/rc-signal`：信令服务，只转发握手消息，并在双方都在线时签发短期 Cloudflare TURN 凭证。它不读取、不保存、也不验证转发的内容。
- `apps/rc-web`：手机打开的静态页面，部署在 EdgeOne Pages。
- `apps/desktop/src/main/remote/`：`RemoteHost` 管理配对、设备房间和连接；`Tunnel` 把每个 DataChannel 流变成一次对本地 web server 的请求。

## 信任

- 二维码包含电脑公钥、一次性配对密钥和信令地址，放在 URL 的 `#` 之后，服务器看不到。页面读取后立即从地址栏移除。
- 双方用长期 ECDSA P-256 密钥签名整个 SDP；首次配对额外用二维码密钥做 HMAC 证明。手机只接受二维码里那把电脑公钥签的回答，电脑只接受已配对设备或持有当前二维码密钥的请求，并且每次新配对都要在电脑上弹窗确认。重放的握手会被拒绝。
- 房间 id 由双方共享的密钥派生，信令服务无法把同一设备的不同房间关联起来。
- 内容经 DTLS 加密；TURN 只转发密文。
- 手机私钥在 IndexedDB 中不可导出。电脑密钥在 Pine agent 目录的 `remote-control.json`（权限 `0600`）。
- 隧道替手机设置 Host、Origin 和登录 Cookie，删除手机发来的同名请求头，并去掉响应里的 `Set-Cookie`。手机能做的事与已登录的浏览器相同，不多不少。远程控制的设置通道只存在于桌面 IPC，不在网页白名单里，所以已配对的手机不能再配对其他设备。
- 在设置中移除设备会立即断开它，之后它无法再连接。

已知限制：手机上内嵌的 Pine 与配对页同源。若一部手机配对了多台电脑，其中一台电脑上被篡改的 Pine 在页面打开期间可以借用这部手机的密钥连接另一台。

## 连接

每一方都把全部候选地址放进一次 SDP。浏览器宣布收集完成可能要几十秒，而有用的候选在几十毫秒内就到了，所以有 TURN 时等到中继候选、否则等到 STUN 候选后再等 250 ms，最多 4 秒（`GatherWatch`）。手机每 15 秒发一次 ping，45 秒听不到回应即视为断开；回到前台时自动重连。

手机端 Service Worker 拦截内嵌页面 `/pine/<token>/` 发出的所有请求（包括它启动的 worker），交给持有 DataChannel 的外层页面发送。Pine 的页面可能用相对路径（资源落在 `/pine/<token>/` 下）或根路径（如 `/api/rpc`），转发时去掉前缀。由 Service Worker 合成的响应会继承站点的 CSP，因此 `rc.aldine.cn` 的 CSP 只限制 `frame-ancestors`、`object-src` 和 `base-uri`。

无头服务端没有确认配对的界面，因此不接受新手机。

## 开发与验证

`PINE_RC_PAGE_ORIGIN` 和 `PINE_RC_SIGNALING` 可以把桌面端指向本地或自建的页面与信令服务。`remote/__tests__/rcHost.test.ts` 用第二个 WebRTC 栈扮演手机，真实走完配对、重连、撤销、大响应和改名；`apps/rc-web` 的说明介绍本地预览和部署。
