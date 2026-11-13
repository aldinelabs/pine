# 从微信向 Pine 发送任务：调研与方案

状态：已实现，只差阶段 0（真机实测，第 10 节）。调研日期 2026-11-12，所有来源的访问日期均为当天。第 11 节的问题已在 2026-11-12 由用户逐项决定。

已实现的结构和规则（组件、命令参考、审批卡片策略、安全不变量、常量、已知限制）记录在 [`docs/architecture/wechat-remote.md`](architecture/wechat-remote.md)，以那里为准。本文保留在 `docs/` 根目录，作为调研、决策和尚未完成的阶段 0 事项的记录，阶段 0 完成后再决定是否删除。

证据标记：

- **[官方]**：腾讯自己的文档、README 或腾讯发布的开源代码。
- **[代码]**：直接读到的官方 npm 包源码。
- **[第三方]**：媒体报道、社区 issue 或社区实现。
- **[推断]**：作者的推断，未经验证。

来源编号见文末。

---

## 1. 结论先行

- **推荐通道：微信 ClawBot（iLink Bot 协议）。** 它是腾讯官方、面向个人微信的一对一 Bot 通道。它的连接方式是**客户端主动长轮询** HTTPS，不需要公网地址和端口转发。所以桥接可以直接跑在 Pine 主进程里（桌面端和无头服务端共用 `main/core`），不需要新建中转服务。
- **不建中转服务。** 中转服务必须持有 bot token，等于把用户微信通道的控制权放到云端。它也无法唤醒睡眠的电脑。社区还反映，从云端或代理出口绑定容易触发“运行环境存在风险”拦截。
- **电脑睡眠或 Pine 未运行时收不到消息。** 这是物理限制。要随时可用，建议用无头服务端，或开启“保持后台运行”并让电脑不睡眠。
- **审批模式。** 微信发起的会话受一个**只能在本机设置**的“微信上限模式”约束，默认 `auto-approve`。复用已有的 `approvalModeWithin`：会话本身、会话里的 `ui_session_new` 以及中途切换模式，都不能超过这个上限。
- **审批交互。**
  - 审批卡片在微信里与在电脑上一样，用两位数编号回复即可批准，包括沙箱拒绝和授权被拒的卡片。
  - 两类审批默认不能在微信里通过，只能在本机或已配对的 Pine Remote 设备上批准：原生执行（`privileged-execution`）和危险命令（`destructive-pattern`）。本机的一个默认关闭的开关可以放宽它们。
  - 自动化相关的审批维持现状：只能在本机批准。
- **最大风险。**
  - ClawBot 服务端规则几乎没有公开文档。`context_token` 的回复条数和时效、频率限制、文件大小上限都只来自社区实测，而且官方会单方面调整。
  - Pine 作为非 OpenClaw 客户端的合规身份没有得到官方答复。
  - 微信账号一旦被盗，攻击者等同于拿到 Pine 的远程入口，所以需要上限模式、高风险审批默认只能在本机进行，以及一键暂停。

---

## 2. ClawBot 调研

### 2.1 是什么、谁在运营

| 项目     | 内容                                                                                                                                                                                                  | 证据                        |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 性质     | 微信内置插件“微信ClawBot”，把个人微信接到 OpenClaw 智能体（或兼容客户端）。在微信里显示为一个联系人。官方称它“并非独立AI工具”，只是消息通道                                                           | [第三方] S10–S12            |
| 运营方   | 腾讯官方：npm 包 `@tencent-weixin/openclaw-weixin` 作者为 Tencent，MIT 许可证，维护者使用 tencent.com 邮箱；仓库为 github.com/Tencent/openclaw-weixin；后端是 `ilinkai.weixin.qq.com`，协议名为 iLink | [代码] S1–S3                |
| 上线时间 | npm 1.0.0 发布于 2026-03-21，随微信 iOS 8.0.70 推出，2026-03-22 公开宣布                                                                                                                              | [代码] S1，[第三方] S10–S13 |
| 当前版本 | 稳定版 2.4.10（2026-10-11）。3.0.0-beta-0（2026-11-09）新增绑定 PIN 校验和他人绑定的实名授权，官方计划以后默认开启                                                                                    | [代码] S1，[官方] S5        |
| 价格     | 免费，没有公开的付费档位或配额                                                                                                                                                                        | [第三方] S12；配额 [未验证] |

### 2.2 注册、绑定与适用范围

- **入口。** 微信 → 我 → 设置 → 插件 → 微信ClawBot，卡片上给出安装命令；客户端展示二维码，用户在微信里扫码确认。[第三方] S10、S11
- **没有开发者注册。** 没有开发者后台、AppID 或审核。凭证由用户扫码产生。[代码] S3
  - 有开发者公开询问独立客户端的申请入口和资质（issue #265），至今无人答复。[第三方] S19 → Pine 的合规身份**无法确认**。
  - 官方协议文档建议第三方宿主把插件版本放在 `channel_version` 前面，例如 `3.0.1/hermes-1.2.0`。这说明官方知道并容忍第三方宿主，但不等于授权。[官方] S6，[推断]
- **绑定流程。** 3.0 beta 区分两种情况：
  - 绑定自己的 Bot：扫码即可。
  - 绑定他人的 Bot：先扫一个实名授权二维码，扫码人须已完成微信支付实名。以后还会要求输入手机上显示的 PIN。[官方] S5、S6
- **客户端版本。** iOS 8.0.70 首发，Android 与鸿蒙随后跟进。[第三方] S10、S21
- **灰度。** 上线时官方说“逐步开放”，按账号判定资格。没有找到已全量开放的可靠信息。[第三方] S10、S12，[未验证]
- **地区。**
  - 海外手机号用户报告“此账号暂时不支持该功能”。[第三方] S18
  - 代理或海外出口会遇到“此OpenClaw的运行环境存在风险，暂无法连接”，而状态接口不返回错误码。[第三方] S20
  - 结论：实际可用范围是中国大陆的个人微信账号。[推断]
- **数量。** 一个微信账号对应一个 Bot；一个客户端实例可以托管多个账号。[第三方] S10，[官方] S4

### 2.3 连接模型与鉴权

- **传输方式：HTTPS JSON 长轮询。** 没有 webhook，也没有 WebSocket。[代码] S3，[官方] S6
  - 客户端调用 `POST ilink/bot/getupdates`，请求体为 `{get_updates_buf}`。这是一个不透明游标，首次传空字符串。
  - 返回 `{ret, errcode, msgs[], get_updates_buf, longpolling_timeout_ms}`。
  - 官方客户端超时 35 s，连续失败 3 次后退避 30 s。[代码] S3
- **地址。**
  - API：`https://ilinkai.weixin.qq.com`。登录结果会返回账号专属的 `baseurl`，扫码阶段也可能通过 `redirect_host` 切换机房。
  - 媒体 CDN：`https://novac2c.cdn.weixin.qq.com/c2c`。[代码] S3
- **扫码登录。**
  1. `POST ilink/bot/get_bot_qrcode?bot_type=3`，得到二维码。
  2. 用 `GET ilink/bot/get_qrcode_status` 长轮询扫码状态，可能的值有：`wait`、`scaned`、`confirmed`、`expired`、`scaned_but_redirect`、`need_verifycode`、`binded_redirect` 等。
  3. 状态为 `confirmed` 时返回 `bot_token`、`ilink_bot_id`、`baseurl` 和 `ilink_user_id`，其中 `ilink_user_id` 是扫码的微信用户。[代码] S3，[官方] S6
- **其余接口。** 都是 POST：`sendmessage`、`getuploadurl`、`getconfig`、`sendtyping`、`msg/notifystart` 和 `msg/notifystop`。[代码] S3
- **鉴权。**
  - 请求头 `Authorization: Bearer <bot_token>` 加上 `AuthorizationType: ilink_bot_token`、`iLink-App-Id` 等。
  - 请求体带 `base_info.channel_version`。
  - **没有请求签名，也没有推送签名**，安全性完全依赖 TLS 和 bot token。[代码] S3
- **token 过期。** 官方没有说明有效期。服务端返回 `-14` 表示 token 失效，官方插件会暂停该账号 1 小时，用户需要重新扫码。[代码] S7
- **服务端风控。** 腾讯维护者回复说，账号和消息由“微信的安全风控系统决定”，请避免刷屏、滥用自动化和绕过平台控制。[第三方·维护者回复] S17

### 2.4 消息格式与限制

- **入站消息字段。** `message_id`、`seq`、`from_user_id`、`to_user_id`、`create_time_ms`、`message_type`（1 = 用户，2 = Bot）、`context_token` 和 `item_list[]`。[代码] S8
- **条目类型。**
  - 1 文本、2 图片、3 语音、4 文件、5 视频。
  - 11/12 是工具调用进度。
  - `ref_msg` 表示引用消息。[代码] S8
- **语音。** 带服务端转写的 `text`，原始格式为 SILK 等。用 Bot 发送语音气泡，据报告不显示。[代码] S8，[第三方] S16
- **发送。**
  - `sendmessage` 每次只发一个条目，必须原样带回 `context_token`。
  - 官方插件 2.1.3 起不再去掉 Markdown，ClawBot 会渲染粗体、行内代码、代码块、引用、列表和表格（只去掉图片和 H5/H6 标题）。[代码] S9a，[官方] S6
- **媒体。**
  - 上传：生成随机 16 字节密钥，用 AES-128-ECB 加密，先 `getuploadurl`，再把密文上传到 CDN，然后在消息里引用。
  - 下载：从 CDN 取回后解密。
  - 用户发来的“原图”会被服务端压缩。[官方] S6，[第三方] S16
- **大小上限。** 官方没有公布。官方插件只把入站媒体的保存上限设为 100 MB。[未验证]
- **回复窗口。** 官方未公布，以下都是社区实测，都在未关闭的 issue 里，官方没有回应：
  - 每条入站消息之后大约能回复 10 次，之后返回 `ret=-2`（#81）。
  - token 有时效：一轮对话开始约 1.5–2 分钟后，出现过失败（#286）。
  - 用户十几个小时不发消息后，主动推送失败；Bot 自己发的消息不会刷新 token（#309）。
  - 有人报告“24 小时、10 条主动消息”的限制，维护者只说“已请产品重新评估”（#202）。
  - 有人遇到较严的 `ret=-2 rate limited`（#270）。

  [第三方] S14、S15、S22、S23

- **主动消息。**
  - 只能在用户最近一条消息留下的有效窗口内发送。
  - 刚绑定、还没有入站消息时，`sendmessage` 返回 `-2`。[第三方] S24
  - 不能主动联系其他好友。
- **静默失败。** 多个 issue 报告 `sendmessage` 返回 0，但手机上看不到消息。[第三方] S16
- **输入中提示。** 支持：先用 `getconfig` 取得 `typing_ticket`，再调用 `sendtyping`。[代码] S3
- **群聊。** 不支持。只能一对一，不能拉进群，别人看不到也加不了。插件声明 `chatTypes: ["direct"]`。[第三方] S12，[代码]

### 2.5 条款、封号风险与隐私

- **专门条款。** 有《微信ClawBot功能使用条款》，但官方原文没能在线找到 [未验证]。第三方转述的要点如下 [第三方] S9：
  - 腾讯只转发消息，不存储输入和输出。
  - 为安全目的收集 IP、操作日志和设备信息。
  - 禁止借此绕过微信的防护。
  - 腾讯可以限制 AI 服务类型和收发规模、审查内容、拦截或封禁，并可随时变更或终止服务。
  - 适用中国大陆法律。
- **隐私。**
  - 官方宣传“本地优先、数据自持”：只申请收发消息的权限，不读聊天记录和通讯录。[第三方] S12
  - 但所有文本和媒体都经过腾讯的服务器与 CDN。媒体虽然加密，密钥同样经腾讯接口下发，所以**应视为腾讯可见**。[代码]，[推断]
  - 没有找到保留期限。[未验证]
- **封号。** 没有公开的处罚规则，由风控系统决定。[第三方] S17
  - 对比：非官方的个人号自动化（Wechaty、Hook、itchat）明确违反《微信软件许可及服务协议》§8.2.1，最重可永久封号 [官方] A9，不考虑。

### 2.6 开源实现

- **官方。**
  - `@tencent-weixin/openclaw-weixin`：TypeScript，MIT 许可证。关键文件是 `src/api/api.ts`、`src/api/types.ts` 和 `src/auth/login-qr.ts`。
  - `docs/protocol.md`（2026-11-05 更新）是最完整的协议参考。[代码] S1–S8
- **社区。** 社区桥接大多复用同一组接口，作者都没有审计过：
  - `fastclaw-ai/weclaw`
  - `formulahendry/wechat-acp`（接 ACP 智能体）
  - `sgaofen/cli-in-wechat`
  - `Johnixr/claude-code-wechat-channel`
  - `qufei1993/cc-weixin`
  - `epiral/weixin-bot`
  - `jeffkit/ilink-hub`
  - `nightsailer/wechat-clawbot`（Python）
  - `SpenserCai/weixin-agent-sdk-rs`（Rust）

  [第三方] S24、S25

### 2.7 已确认与未确认

| 已确认（官方文档或代码）                                                                                 | 未确认 / 只有社区实测                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 腾讯官方运营，接口地址、字段和加密方式，长轮询，无签名，`-14` 表示需重新扫码，不支持群聊，支持输入中提示 | `context_token` 的条数和时效、频率配额、媒体大小上限、离线期间服务端是否保留消息以及保留多久、bot token 的有效期、条款原文、第三方客户端是否被允许、海外账号和代理出口的具体规则 |

---

## 3. 备选方案对比

详细调研见文末 A 组来源。

| 方案                                          | 官方 | 连接方式                              | 需要公网地址                   | 主动消息                                                         | 媒体                                 | 群聊      | 门槛与费用                                         | 封号风险                | 是否适合 Pine                                          |
| --------------------------------------------- | ---- | ------------------------------------- | ------------------------------ | ---------------------------------------------------------------- | ------------------------------------ | --------- | -------------------------------------------------- | ----------------------- | ------------------------------------------------------ |
| **微信 ClawBot**                              | 是   | 客户端长轮询                          | 否                             | 只在用户最近消息的窗口内（社区实测约 10 条、有时效）             | 图片、文件、视频；语音只能收         | 否        | 个人微信扫码，免费；实际限大陆账号                 | 由风控决定，未公布规则  | **首选**                                               |
| 企业微信·智能机器人（长连接）                 | 是   | 出站 WSS，每个 Bot 只能有 1 条连接    | 否                             | 用户发过消息后，每会话 30 条/分钟、1000 条/小时，24 小时内可回复 | 只在单聊中支持，分片上传             | 支持 @Bot | 免费企业微信组织；**个人微信用不了**（第三方说法） | 无                      | 备选：给能接受企业微信 App 的用户                      |
| 公众号（服务号/订阅号）                       | 是   | 推送到 webhook，5 秒内响应，重试 3 次 | **是**（80/443）               | 客服消息：每次用户消息后 48 小时内 5 条；模板消息需认证服务号    | 图片 ≤10 MB，语音 ≤2 MB，视频 ≤10 MB | 否        | 个人只能开订阅号，且无高级接口；认证约 300 元/年   | 无                      | 不适合：每个用户都要有公网服务器，或由 Aldine 统一中转 |
| 企业微信·群机器人 webhook                     | 是   | 只能发送                              | 否                             | 20 条/分钟                                                       | 文件 ≤20 MB                          | 内部群    | 免费                                               | 无                      | 只能做通知，收不到任务                                 |
| 企业微信·自建应用                             | 是   | 回调 + REST                           | **是**，还要可信 IP 和备案域名 | 是                                                               | 是                                   | 是        | 需认证企业和备案域名                               | 无                      | 不适合                                                 |
| 个人号非官方自动化（Wechaty、WeChatFerry 等） | 否   | 协议模拟或 Hook                       | 否                             | 是                                                               | 是                                   | 是        | 付费 token 或锁定旧版客户端                        | **高**，违反协议 §8.2.1 | 排除                                                   |
| 飞书 / 钉钉（长连接 / Stream）                | 是   | 出站 WebSocket                        | 否                             | 是                                                               | 是                                   | 支持 @Bot | 免费组织，需自建应用                               | 无                      | 非微信用户的后续选项，形态与 ClawBot 方案一致          |

结论：

- 在“个人微信 + 无公网地址”的条件下，ClawBot 是唯一的官方通道。
- 企业微信智能机器人在技术上同样合适，而且限额公开、更宽，但要求用户使用企业微信 App。
- 桥接层的接口按“消息通道”抽象，以后可以接企业微信、飞书或钉钉，第一版只实现 ClawBot。

---

## 4. Pine 现有远程控制，以及可以复用的部分

现状见 `docs/architecture/remote-control.md` 和 `local-web-control.md`：

- **远程控制的数据路径。** `RemoteHost`（`main/remote/rcHost.ts`）在信令房间里等待已配对设备的签名 offer，建立 WebRTC DataChannel 后，由 `Tunnel` 把流量转成对本地网页服务的 HTTP 请求。设备运行的是 Pine 自己的网页界面。
- **配对的信任模型。** 一次性密钥，加上电脑上的确认弹窗 `host.approveRemotePairing`，加上长期 ECDSA 密钥、`ReplayGuard` 防重放。设置通道只走桌面 IPC，不在网页白名单里，所以已配对设备不能再配对别的设备。
- **会话与审批。**
  - `PineCore.routeAgentEvent` 把 `approval-request` 和 `questionnaire-request` 记到 `runtimes` 上，并分发给附着的客户端。
  - `runtimes.respondApproval` 和 `runtimes.respondQuestionnaire` 由各客户端调用，“共享客户端中只有首个有效响应生效”。
  - 审批请求带 `actionDigest`，用来把审批卡片绑定到工作进程里那次调用的不可变快照。
- **后台起会话。** `answerSessionOperation` 中 `op: "start"` 的路径已经有完整的后台起会话逻辑：
  1. 用 `approvalModeWithin(requested, callerMode)` 限制审批模式。
  2. 项目已在别的窗口打开时拒绝；未附着时用 `runtimes.share`。
  3. 调用 `runtimes.prompt(owner, { target: { kind: "new", projectId }, approvalMode, message, locale }, { focus: false })`。
  4. 调用 `notifyLibraryChanged("sessions")`。
- **先例。**
  - 自动化（`AutomationService`）是“不属于任何窗口的会话”的先例：它自己观察事件，自己处理 host request。
  - 网页服务用虚拟客户端 `WEB_CLIENT_ID` 共享运行时，这是“非窗口客户端”的先例。
  - `TinyFishCredentialStore` 配合 `host.credentialStorage` 是保存敏感凭据的先例。

**微信桥不复用 WebRTC 隧道。** 隧道解决的是“外部设备连到电脑”，而 ClawBot 本来就是电脑主动连出去，不存在 NAT 问题。复用的是另外几样：

1. 信任模型的形式：一次性配对、本机确认、凭据 `0600` 加密存储、设置通道只走桌面 IPC。
2. 会话层：`runtimes.prompt`、`approvalModeWithin`、审批和问卷的应答通道，以及审批“首个有效响应生效”的语义。
3. 远程控制设置分类和托盘开关的位置。

已配对的 Pine Remote 设备在本方案里另有用途：充当**高风险审批的强认证通道**（见第 7 节）。

---

## 5. 架构

```text
微信 App ──(腾讯 iLink)── ilinkai.weixin.qq.com
                               ▲ HTTPS 长轮询 / sendmessage（出站，无需公网地址）
                               │
Pine 主进程 / 无头服务端 (main/core)
  WeChatBridge ── packages/wechat-ilink（协议客户端，无 Electron 依赖）
     │  命令解析、身份校验、去重、发送队列
     ├─> runtimes.prompt / abort / sendSteering / respondApproval / respondQuestionnaire
     └─< routeAgentEvent 的观察钩子（run-state、approval-request、questionnaire-request、present-file、最终回复）
```

### 5.1 运行位置

- **代码位置。** `WeChatBridge` 放在 `apps/desktop/src/main/wechat/`，由 `PineCore` 持有，桌面端和无头服务端共用。`vite.server.config.ts` 禁止引入 `electron`，这一约束同样适用。
- **新包 `packages/wechat-ilink`。**
  - 职责：只实现 iLink 协议，包括扫码登录、`getupdates` 游标、`sendmessage`、`sendtyping`、媒体加解密与上传下载，以及错误码分类。
  - 边界：不知道 Pine 的会话和审批；输入输出都是普通的类型化对象；`fetch` 由外部注入（与 `rc-protocol` 的 `Fetch` 一致）。
  - 不加运行时依赖：用 `fetch` 加 `node:crypto` 的 `aes-128-ecb` 就够了。这也避开了“新增依赖会顺带改动 `pi-ai` 锁定版本”的问题。
  - 验证：Vitest 配本地 mock iLink 服务器。
  - 实现参照腾讯 MIT 代码，在文件头注明来源。不直接依赖 `@tencent-weixin/openclaw-weixin`，因为它是 OpenClaw 插件，带 OpenClaw 运行时约定。
- **网络出口。** 用 `host.fetch`，与 Pine 的其他网络请求一致。设置页提示：代理或海外出口可能导致绑定被风控拦截。

### 5.2 NAT 与睡眠

- **NAT。** 不受影响，全是出站请求。
- **Pine 未运行或电脑睡眠时。** 长轮询停止。
  - 服务端是否按 `get_updates_buf` 游标保留离线消息、保留多久，目前**未验证**，阶段 0 需要实测。
  - 即使保留了，醒来时 `context_token` 也可能已过期，结果发不回去。
- **处理办法。**
  1. 设置页明确写出：“只有 Pine 运行、电脑未睡眠时才能收到微信任务。”需要随时可用的用户，建议用[无头服务端](https://docs.aldine.cn/zh/pine/advanced/server/)。
  2. 微信远程开启时，提供一个可选项“微信远程开启时阻止电脑自动睡眠”，用 Electron `powerSaveBlocker` 实现。它挡不住合盖睡眠，界面上要如实说明。
  3. 醒来后收到的旧消息：超过 10 分钟的“开始任务”类消息先暂存，用户回复 `.y NN` 确认后才执行；其他过期命令不执行（规则见 `docs/architecture/wechat-remote.md` 的“过期消息”）。
  4. 不建云端中转：它解决不了睡眠，反而要把 bot token 放到云端，还更容易触发风控。

### 5.3 会话归属

微信发起的会话必须出现在桌面侧栏，用户回到电脑前可以接手。

- **项目没有被任何窗口打开时。** 桥接器以虚拟客户端 `WECHAT_CLIENT_ID` 共享运行时（与 `WEB_CLIENT_ID` 同样的机制），然后调用 `runtimes.prompt(..., { focus: false })`。
- **项目已被某个窗口打开时。** 在该窗口名下后台启动，与 `answerSessionOperation` 一致，不抢焦点。桥接器通过事件观察钩子跟踪该会话。
  - 起会话的公共部分是 `startBackgroundSession`（`main/core/requests/sessions.ts`），`ui_session_new` 和微信桥共用，各自决定 owner。
- **事件观察。** `PineCore.routeAgentEvent` 在分发事件后调用 `core.wechat.observeAgentEvent`。桥接器缓存所有经过这个钩子的会话的运行状态和待处理审批，但只为跟踪的会话推送：自己发起的会话、用户用 `.use` 选中的会话，以及它们派生的子会话。
- **持久化。** 当前会话、跟踪的会话和来源记录存入桥接器状态文件，Pine 重启后 `.status` 仍可用。

---

## 6. 绑定与认证

### 6.1 绑定流程

1. 用户在 Pine 设置 › 远程控制 › 微信中点击“连接微信”。只在桌面窗口或无头服务端终端里可用：这个设置通道不进 `webRequestPolicy` 白名单，与远程控制配对相同。已配对的远程设备和浏览器访问都不能绑定微信。
2. 主进程调用 `get_bot_qrcode`，弹窗显示二维码和有效期。用户用**自己的**微信扫码并在手机上确认。需要验证码时（`need_verifycode`，3.0 的 PIN），弹窗提供输入框。
3. 扫码状态变为 `confirmed` 后，Pine 得到 `bot_token`、`baseurl`、`ilink_bot_id` 和 `ilink_user_id`，但先只放在内存里，进入**配对**阶段：继续轮询，不执行、不转发任何内容。
4. 对话框请用户在微信里给 Bot 发任意一条消息（一个点即可）。这个账号的第一条消息收到一个 6 位配对码（最多发两次），除此之外这个阶段不发送任何内容。没有入站消息时 Bot 本来就无法主动发送，所以这一步同时打开了回复窗口。
5. 用户在电脑上的对话框（无头服务端：终端）输入配对码。输错 3 次或超过 5 分钟，本次绑定结束，token 被丢弃。配对码从手机传到电脑：只看到屏幕或日志的人收不到它，在别处扫码的人也无法在本机输入。
6. 配对成功后：
   - `bot_token`、主人身份和权限设置作为密封数据通过 `host.credentialStorage` 保存（桌面端用系统钥匙串加密，服务端是 `0600` 的明文文件，与 TinyFish 密钥一致）。权限设置重置为默认值，新账号不会继承之前的设置。
   - `ilink_user_id` 记为**唯一主人**，`get_updates_buf` 和其余状态写入 Pine agent 目录的 `wechat-remote.json`，权限 `0600`。
   - Bot 发送欢迎消息和常用命令。

同一个已配对账号重新扫码（`-14` 之后）跳过配对，保留跟踪的会话和待发通知。

### 6.2 认证模型

- **到腾讯这一侧。** 只有 TLS 加 bearer token，没有签名可以校验。token 只存在本机。
- **消息来源。** 每条入站消息必须满足以下全部条件，否则静默丢弃并计数：
  - `message_type == 1`
  - `from_user_id` 等于已绑定的主人
  - `to_user_id` 等于本 Bot
  - `message_id` 没有处理过
- **Pine 只接受一个主人。** 想换微信号，必须在本机解绑后重新绑定。
- **解绑与失效。**
  - “断开微信”会清除 token 和状态，并调用 `msg/notifystop`。
  - 收到 `-14` 时提示“需要重新扫码”，并在桌面发通知。
- **桥接器内的 Bot 身份。** 腾讯的 bot token 只证明“消息来自这个微信账号”，证明不了“是你本人在操作”。所以账号被盗的情况要靠第 7、8 节的权限上限兜底，不能指望绑定环节。

---

## 7. 命令与交互

ClawBot 会渲染一小部分 Markdown（Pine 只用粗体、行内代码、代码块、引用和列表），而且每条入站消息之后能回复的条数有限、有时效。设计原则是：**一条入站消息只回一条（`.file` 和 `.compact` 回两条），每条回复都能单独看懂，发不出去的推送排队，等用户下一条消息时合并成一段摘要补发。**完整的命令参考见 [`docs/architecture/wechat-remote.md`](architecture/wechat-remote.md)。

### 7.1 语法与命令

- **普通文字**发给“当前会话”：空闲时作为下一条消息，运行中时作为 steering；没有当前会话时在当前项目里新开一个。当前会话有审批或问题在等待时加入 steering 队列，回复里列出等待中的卡片和回应方式，`.撤回` / `.recall` 可撤回。
- **点命令**以 `.`、`。`、`．` 或 `｡` 开头：`.命令 参数1 参数2`。名称不分大小写；每个命令有一个字母的短别名和中文别名，中文别名可以直接接文字（`.新修一下登录页`）。
- 只有一个点 = 状态；`.?` = 帮助；`.0` = 下一页。`.N` 选最后一次列表的第 N 行，`.9` 是最新推送的会话，`.11`–`.99` 显示该编号的卡片全文。
- 以点开头的普通文字用两个点发（`..env 没提交`）。看起来像命令却不认识的（`.statsu`）不会发给智能体，回复提示和建议。
- 列表每页最多 8 行，编号 30 分钟有效；推送不改变列表编号。
- 引用、转发、语音转写和文件名里的文字从不作为命令。

按用途分组（括号里是短别名）：

| 分组                | 命令                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 状态与桥接          | `.status`（`.`、`.s`）、`.help`（`.h`、`.?`）、`.info`（`.cfg`）、`.lang`、`.pause`、`.more`（`.0`）、`.drop`                                                                                                            |
| 会话                | `.new`（`.n`）、`.sessions`（`.l`）、`.search`（`.f`）、`.use`（`.u`）、`.last`（`.r`）、`.history`（`.hi`）、`.stop`（`.x`）、`.queue`（`.q`）、`.unqueue`（`.qx`、`.recall`）、`.rename`（`.rn`）、`.delete`（`.del`） |
| 模型与上下文        | `.model`（`.m`）、`.effort`（`.e`）、`.mode`（`.mo`）、`.usage`（`.i`）、`.compact`（`.c`）、`.todo`（`.t`）                                                                                                             |
| 审批与问题          | `.pending`（`.w`）、`.show`、`.approve`（`.y`）、`.reject`（`.d`）、`.guide`（`.g`）、`.answer`（`.a`）                                                                                                                  |
| 文件与后台进程      | `.files`（`.o`）、`.file`（`.send`）、`.tasks`（`.b`）、`.task`、`.kill`（`.k`）                                                                                                                                         |
| 项目                | `.projects`（`.p`）                                                                                                                                                                                                      |
| 自动化、Skills、MCP | `.autos`（`.au`）、`.auto N [on\|off\|run]`、`.runs`（`.ar`）、`.skills`（`.sk`）、`.mcp`                                                                                                                                |

任务完成时推送：会话标题、用时和费用、最终回复的前 300 字，以及 `.r 全文 · .o 文件`。只有桥接器发出最新提示的那一轮才推送完成和失败；运行超过 10 分钟时最多再推送一次进度。

### 7.2 审批与问卷

**编号。** 每个待处理项（审批、问题、确认、暂存的过期消息）有一个两位数编号 11–99，只能用一次，审批绑定 `requestId + actionDigest`。审批已由别处决定、运行结束或编号过期后，编号作废，再用时回复“已经处理过了”。编号和列表的 1–8、推送会话的 9、问题选项的 1–4 不会冲突。

```text
【pine › 修登录页】需要批准 12
bash · 沙箱拒绝
rm -rf build/ && make
.y 12 批准 · .d 12 拒绝 · .d 12 你的建议
```

- **应答。** `.y 12` 批准，`.d 12` 拒绝，`.d 12 说明` 或 `.g 12 说明` 拒绝并附上说明，经 `runtimes.respondApproval` 提交，与其他客户端遵循“首个有效响应生效”。`.y` 不带编号只用于暂存的过期消息批次。
- **卡片策略。** 审批卡片在微信里与在电脑上一样：任何工具、任何触发原因都可以批准，包括沙箱拒绝（`sandbox-denied`）和授权被拒（`authorize-denied`）。例外只有三种，在微信里只显示内容并提示“请在这台电脑或 Pine Remote 中批准”，仍可 `.d` 拒绝：
  - 原生执行（`privileged-execution`）和危险命令（`destructive-pattern`）：需要本机打开默认关闭的“Allow approving high-risk actions from WeChat”，打开后批准它们会发本机通知。
  - 自动化的创建、修改、启用：只能在本机批准。
  - 只读会话（模式高于上限，或属于自动化运行）的卡片。
- **截断的内容。** 卡片主题超过 300 字时被截断，必须先用 `.show 12`（或 `.12`）看过全文才能批准。
- **外部内容。** 会话此前读过附件、引用或网页内容时，卡片多一行提醒。
- **`long-context-activation` 卡片。** 只提供 `.c 12`（压缩后继续）和 `.d 12`（停止）。

**问卷。** `questionnaire-request` 渲染为带编号的问题和选项：

```text
【pine › 修登录页】问题 13
Q1 用哪种登录方式？（单选）
 1 邮箱验证码
 2 密码
Q2 需要哪些环境？（可多选）
 1 开发  2 预发  3 生产
回答：.a 13 2; 1,3 · 自己写：.a 13 =文字 · 取消：.d 13
```

- 各题答案用分号或换行隔开，按顺序回答；只有一题时整段就是答案。数字选项从 1 开始，`=` 开头强制作为自由文本。
- 提交前用与界面相同的规则校验，不符合时说明期望的格式，什么也不提交。
- 带预览或代码、一条回复放不下的问卷只发摘要和“请在 Pine 中回答”。

**确认。** `.delete`、`.mode yolo` 和 `.auto N run` 先回复一个确认编号，2 分钟内 `.y NN` 才执行，执行时重新核对目标。

**无人回应时。** 审批卡片会一直等着，与桌面上的行为一致。因为回复额度用完而没发出去的卡片进入发送队列，用户发下一条消息时，摘要里列出待处理的编号，`.w` 查看全部。

### 7.3 文件与媒体

- **入站。**
  - 图片和文件解密后先暂存，随下一条文字、`.new` 或 `.queue` 存入 Pine 管理的项目附件目录，与网页上传的处理方式相同：服务端生成文件名，原文件名只用于显示，作为附件随消息发给 agent。`.drop` 丢弃暂存的附件。
  - 语音用服务端转写的文本，作为普通消息；没有转写时请用户打字。
  - 视频先只保存为附件。
  - 单个文件超过上限（100 MB，出站相同；阶段 0 实测后可下调）时拒绝并说明。
- **出站。**
  - 默认**不发送任何文件内容**，`.files` 只列出文件名和大小。
  - 设置里的“Allow sending files to WeChat”开启后，`.file N` 才会上传 agent 展示过的文件；不展示的项目内任意路径不发。发送时文件的真实路径必须与展示时相同。
  - 上传前在微信里显示文件名和大小，发送后在电脑上弹出通知。
  - 出站文件同样经过腾讯 CDN，设置页的隐私说明写清楚了这一点。

### 7.4 审批模式规则

这是硬性约束。

1. **只在本机设置两个值。**
   - **Highest approval mode（微信上限）**：默认 `auto-approve`。
   - **Default approval mode（微信默认模式）**：默认等于上限，不能超过上限。
   - 两个设置只能在桌面设置页或 `pine-server wechat config` 修改，设置通道不在网页白名单里，微信命令也改不了它们。
2. **新会话。** 微信新开会话时使用默认模式，并用 `approvalModeWithin(mode, ceiling)` 钳制。每次发送都显式带上审批模式，发送前再断言一次不超过当前上限。
3. **后续变化不能突破上限。**
   - agent 用 `ui_session_new` 起的会话：已有的 `approvalModeWithin(requested, callerMode)` 规则自动传递上限。
   - `.mode` 在微信里切换当前会话的模式：收紧总是允许；放宽最多到上限；`.mode yolo` 只有上限是 YOLO 时可用，并且需要确认，确认文字带上与界面相同的 YOLO 警告。
   - 用户在桌面窗口里切换不受限制，因为那是本机的明确操作。模式高于上限的会话在微信里变为只读：只能查看、停止和拒绝，用 `.mode` 降到上限以内后可以继续。本机降低上限时同样如此，不会强制降级。
4. **YOLO。** 允许在本机把微信上限设为 YOLO，默认仍是 `auto-approve`。YOLO 会跳过全部审批，包括第 7.2 节的高风险审批，所以选择它时设置页明确警告：微信账号被盗等同于这台电脑被完全控制。

选择 `auto-approve` 作为默认值的理由：

- `let-me-review` 会让每个需要审批的操作都发到微信，很快耗尽回复额度。
- `autonomous` 把所有升级交给审批模型，用户在微信里完全看不到风险操作。
- `auto-approve` 让审批模型处理常规操作，只把它没有把握的操作升级到微信。

---

## 8. 安全威胁与对策

| 威胁                     | 场景                                                 | 对策                                                                                                                                                                                                                                                                   |
| ------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 微信账号被盗或被他人登录 | 攻击者可以给 Pine 下任务、批准卡片                   | 本机设置上限模式；高风险审批默认不能在微信里批准；绑定需要在本机输入发到微信的配对码；每个微信发起的会话都在本机弹出系统通知；`.pause` 和托盘开关可一键停用，只能在本机恢复；侧栏标记“From WeChat”“Used from WeChat”，便于审计                                         |
| 伪造消息                 | 别的微信用户或中间人冒充主人                         | ClawBot 只能一对一，外人加不上。仍然严格校验 `from_user_id`、`to_user_id`、`message_type` 和 `group_id`，只信任 TLS 连到的 `*.weixin.qq.com`（CDN 另允许 `*.qq.com`），不跟随重定向。不接受服务端下发的任意 `baseurl`，只接受 `weixin.qq.com` 子域，每次启动都重新检查 |
| bot token 泄漏           | 本机的其他程序或备份读到 token                       | 用 `credentialStorage` 保存（桌面端加密，无头服务端是 `0600` 明文文件）；token 不写日志、不进诊断导出；断开时同时清除                                                                                                                                                  |
| 重放和重复投递           | 网络重试、游标回退、睡眠醒来后收到旧消息             | 已处理的 `message_id` 和 `seq` 存在有界的持久化表里；游标落盘；“开始任务”类消息的 `create_time_ms` 早于 10 分钟（或缺失、超前）时先暂存，回复 `.y NN` 后才执行，其他过期命令不执行；审批编号只能用一次，并且绑定 `actionDigest`                                        |
| 转发内容带来的提示注入   | 用户转发了群聊记录、文章、文件，内容里夹带“请执行……” | 只把用户亲手输入的文本当作指令；引用的消息（`ref_msg`）、转发和文件以附件或引用块的形式交给 agent，标明“来自外部内容”；真正的防线仍是沙箱、审批和上限模式，第 7.2 节的高风险审批默认不能在微信里批准；微信会话里读取外部内容之后，审批卡片附上与自动化相同的警示       |
| agent 外传数据到微信     | 注入内容诱导 agent 把敏感文件发到微信                | agent **没有**“发送到微信”的工具，桥接器只发最终回复和用户用 `.file N` 点名的、agent 展示过的文件；文件发送默认关闭                                                                                                                                                    |
| 刷屏与风控               | 异常的发送频率触发腾讯风控，导致封号                 | 每条入站消息之后的回复有额度和优先级，过程消息每轮最多一次；`sendmessage` 返回非 0 时不重试，进入发送队列，等下一条入站消息；从不主动联系主人之外的任何人                                                                                                              |
| 恶意或篡改的 iLink 响应  | 畸形 JSON 或超大媒体                                 | 校验所有响应的结构；媒体限制大小，解密失败就丢弃；文本长度有上限                                                                                                                                                                                                       |

---

## 9. 用户可见的变化

这些变化需要在同一个提交里同步更新 `PINE_UI.md`。

- **Pine Settings › Remote control 新增“WeChat”分组**，只在桌面端或终端中设置，不在网页中提供：
  - 一个“Connect WeChat”按钮，加上二维码对话框、验证码输入框和配对码输入框。
  - 已绑定时显示微信用户的摘要和状态（在线、连接中、重试中、需要重新扫码、已暂停），“Scan again”、“Disconnect”按钮，以及“Receive tasks from WeChat”开关。
  - “Default project”。
  - 分组标为实验性功能，并说明它可能随腾讯政策变化而失效。
  - “Highest approval mode”，选项为 Let Me Review、Auto Approve、Autonomous Work、YOLO，选 YOLO 时显示警告。另有“Default approval mode”。
  - “Allow approving high-risk actions from WeChat”，默认关闭；开启后原生执行和危险命令也能在微信里用编号批准。
  - “Allow sending files to WeChat”，默认关闭。
  - “Keep the computer awake while WeChat is on”，并说明合盖仍会睡眠。
  - 说明文字：只在 Pine 运行时可用；消息经过腾讯服务器；绑定的账号可以读到所有项目的会话标题、搜索结果和回复；代理出口可能被拦截；一个微信号只连一台电脑。
- **侧栏与会话。** 从微信启动的会话带“From WeChat”标记，微信发过消息的已有会话带“Used from WeChat”标记；会话顶部显示同样的标签。
- **审批卡片。** 不能在微信里批准的卡片，在 Pine 里外观不变；在微信里提示“请在本机批准”。微信发起的自动化开启请求在电脑上的卡片注明“Requested from WeChat”。
- **通知。** 微信发起会话、第一次使用已有会话、批准高风险操作、发送文件、删除会话、运行自动化、切到 YOLO、需要重新扫码、暂停和设置被重置时都会弹出系统通知，不受注意力通知开关影响。
- **托盘与菜单栏。** 与 Browser access、Remote Control 并列，加一个 WeChat 开关。
- **退出确认。** WeChat 开启时，退出确认的提示里要包含它。
- **其他同步。**
  - 九种语言包。
  - docs 仓库中英文各增加一页“从微信使用 Pine”，并在无头服务端页面补充说明。
  - CHANGELOG 中英文各一条。

---

## 10. 分阶段实施

每个阶段一个或几个原子提交。提交前运行 `bun run check`，依赖类和 `shadcn:add` 改动单独提交。

| 阶段                                                                    | 内容                                                                                                                                                                                                               | 验证方法                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0. 可行性实测（不进产品代码）——**未完成**                               | 在 scratch 目录写一个一次性脚本，用测试微信号走完：扫码绑定 → 收发文本 → 进程离线 1 小时和 12 小时后游标是否补回消息 → 每条入站消息之后的回复条数和时效 → 媒体上传下载 → 走代理出口时是否被拦截 → `-14` 后如何恢复 | 把实测结论记录到本文第 2.7 节，更新“未确认”一栏，据此定下默认额度和超时                                                                                                                                                                                      |
| 1. `packages/wechat-ilink`——已完成                                      | 协议客户端：登录状态机（含机房切换和验证码）、`getupdates` 与游标、`sendmessage`、`sendtyping`、错误码分类（`-14`、`-2`）、AES-128-ECB 媒体、响应校验；不引入运行时依赖                                            | Vitest 加本地 mock iLink 服务器，覆盖状态机、退避、游标、加解密往返和畸形响应；`bun run check`                                                                                                                                                               |
| 2. 绑定与状态（主进程）——已完成                                         | `main/wechat/` 的 `WeChatStore`（`credentialStorage` 加 `0600` 状态文件）和 `WeChatBridge` 的生命周期（启动、停止、暂停）；绑定 IPC 只进桌面端，不进网页白名单；配对码；设置界面；`PINE_UI.md`；i18n               | 单元测试：来源校验、去重、白名单中没有微信通道（`webRequestPolicy` 测试）、凭据不出现在诊断导出里；用真实微信号绑定和解绑属于阶段 0                                                                                                                          |
| 3. 命令：开始、状态、停止、继续——已完成                                 | 抽出起会话的公共函数，由 `ui_session_new` 与微信共用；虚拟客户端与 owner 选择；上限校验；发送队列与额度；旧消息确认；侧栏标记和系统通知                                                                            | 测试：上限不能被突破（新会话、`ui_session_new` 链、`.use`、`.mode`）；项目已在窗口打开时由该窗口持有并在后台运行；`.stop` 后状态正确；队列在下一条入站消息时补发。用 mock 服务器跑端到端，再用 mock provider 跑一轮 agent（参考 `bun run verify:pi` 的做法） |
| 4. 审批与问卷——已完成                                                   | 两位数编号、`actionDigest` 绑定、作废逻辑；高风险审批默认不能在微信里批准；问卷渲染与解析                                                                                                                          | 测试：首个有效响应生效（桌面和微信同时回应）；作废和重放的编号被拒绝；`privileged-execution` 卡片在开关关闭时无法在微信里批准；问卷解析的边界情况                                                                                                            |
| 5. 文件与媒体——已完成                                                   | 入站附件进项目附件目录；语音转写；出站 `.file N` 受设置开关和大小上限约束                                                                                                                                          | 测试：文件名由服务端生成，不能越过附件目录；关闭开关时绝不调用 `getuploadurl`；超过上限时拒绝                                                                                                                                                                |
| 6. 收尾与发布——已完成（docs 仓库的用户页面和 CHANGELOG 随发布另行处理） | 防睡眠选项；托盘开关；退出确认；`-14` 引导；docs 仓库中英文页面；CHANGELOG；无头服务端支持（终端里画出二维码，`--wechat-bind`，`pine-server wechat …`）                                                            | `bun run check`、`bun run build:server`、`bun run verify:pi`、对 mock iLink 服务器的端到端测试；用真实账号手动验证属于阶段 0                                                                                                                                 |

---

## 11. 已决定的问题

2026-11-12 由用户逐项决定。

1. **合规。** 先做，功能标为实验性；设置页写明它可能随腾讯政策变化而失效。阶段 0 真机实测通过后，再决定是否随正式版发布。
2. **默认上限。** 上限默认 `auto-approve`，默认模式等于上限。允许在本机把上限设为 YOLO，选择时显示警告（见第 7.4 节）。
3. **高风险审批。** 原生执行和危险命令默认不能在微信里批准；允许用户在本机打开一个默认关闭的设置项来放宽。
4. **文件外发。** 默认关闭，开启后只能发 agent 展示过的文件。出入站单个文件上限 100 MB，阶段 0 实测后可下调。
5. **离线体验。** “开始任务”类消息发出超过 10 分钟的，先要求用户确认再执行；10 分钟内的直接执行。
6. **备选通道。** 第一版只做 ClawBot。桥接层按“消息通道”抽象，企业微信智能机器人以后再说。
7. **无头服务端。** 与桌面端同步支持。
8. **多台电脑。** 一个微信号只能绑一台，在设置页说明；不做转发。

---

## 来源

ClawBot（访问日期均为 2026-11-12）：

- S1 npm `@tencent-weixin/openclaw-weixin`（创建于 2026-03-21，修改于 2026-11-09）https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin
- S1b npm `@tencent-weixin/openclaw-weixin-cli`（2026-03-21）https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin-cli
- S2 https://github.com/Tencent/openclaw-weixin（创建于 2026-03-27，推送于 2026-11-09）
- S3 `src/api/api.ts` 和 `src/auth/login-qr.ts`（2.4.10，2026-10-11）https://github.com/Tencent/openclaw-weixin/blob/main/src/api/api.ts
- S4 README（2.4.10）https://github.com/Tencent/openclaw-weixin
- S5 `docs/release-notes-bot-realname-auth_zh_CN.md`（2026-11-09）https://github.com/Tencent/openclaw-weixin/blob/main/docs/release-notes-bot-realname-auth_zh_CN.md
- S6 `docs/protocol.md`（2026-11-05）https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md
- S7 `src/api/session-guard.ts`（2.4.10）https://github.com/Tencent/openclaw-weixin
- S8 `src/api/types.ts`（2.4.10）https://github.com/Tencent/openclaw-weixin/blob/main/src/api/types.ts
- S9 hao-ji-xing `weixin-bot-api.md`（约 2026-03-22）https://github.com/hao-ji-xing/openclaw-weixin/blob/main/weixin-bot-api.md
- S9a `src/messaging/send.ts` 和 `markdown-filter.ts`（2.4.10）https://github.com/Tencent/openclaw-weixin
- S10 PingWest（2026-03-23）https://www.pingwest.com/a/312336
- S11 36Kr（2026-03-23）https://www.36kr.com/p/3735278874047240
- S12 新浪科技 / TechWeb（2026-03-23）https://finance.sina.com.cn/tech/roll/2026-03-23/doc-inhrxrnc4259110.shtml
- S13 TechNews（2026-03-23）https://technews.tw/2026/03/23/tencent-enables-openclaw-integration-in-weixin/ ；光明网（2026-03-22）https://m.gmw.cn/2026-03/22/content_1304386443.htm
- S14 issue #81（2026-04-22）https://github.com/Tencent/openclaw-weixin/issues/81
- S15 issue #286（2026-09-05）https://github.com/Tencent/openclaw-weixin/issues/286
- S16 issues #235（2026-07-23）、#268（2026-08-27）、#363（2026-10-28）、#378（2026-11-07）https://github.com/Tencent/openclaw-weixin/issues/363
- S17 issue #253（2026-08-11，维护者回复于 2026-09-02）https://github.com/Tencent/openclaw-weixin/issues/253
- S18 issue #122（2026-05-06）https://github.com/Tencent/openclaw-weixin/issues/122
- S19 issue #265（2026-08-25）https://github.com/Tencent/openclaw-weixin/issues/265
- S20 issues #341（2026-10-10）、#367（2026-10-30）https://github.com/Tencent/openclaw-weixin/issues/341
- S21 中华网（2026-03-30）https://m.tech.china.com/articles/20260330/202603301836597.html
- S22 issue #309（2026-09-14）https://github.com/Tencent/openclaw-weixin/issues/309
- S23 issues #202（2026-06-15）、#270（2026-08-28）https://github.com/Tencent/openclaw-weixin/issues/202
- S24 fastclaw-ai/weclaw（推送于 2026-11-05）https://github.com/fastclaw-ai/weclaw ；issue #356（2026-10-22）https://github.com/Tencent/openclaw-weixin/issues/356
- S25 plustar35/wechat-clawbot-notify（2026-04-18）https://github.com/plustar35/wechat-clawbot-notify ；epiral/weixin-bot（2026-03-22）https://github.com/epiral/weixin-bot

备选方案（访问日期均为 2026-11-12；未注明日期的表示页面没有显示日期）：

- A1 公众号消息推送（2026-03-05）https://developers.weixin.qq.com/doc/service/guide/dev/push/
- A2 接收普通消息（2026-03-05）https://developers.weixin.qq.com/doc/service/guide/product/message/Receiving_standard_messages.html
- A3 服务号客服消息（2026-03-05）https://developers.weixin.qq.com/doc/service/guide/product/kf/intro.html ；订阅号客服消息（2026-03-08）https://developers.weixin.qq.com/doc/subscription/guide/product/kf/intro.html
- A4 模板消息（2026-03-05）https://developers.weixin.qq.com/doc/service/guide/product/template_message/Template_Message_Interface.html
- A5 临时素材（2026-03-16）https://developers.weixin.qq.com/doc/service/api/material/temporary/api_uploadtempmedia.html
- A6 企业微信智能机器人长连接（2026-10-10）https://developer.work.weixin.qq.com/document/path/101463 ；概述（2026-04-09）https://developer.work.weixin.qq.com/document/path/101039
- A7 企业微信群机器人（2025-08-07）https://developer.work.weixin.qq.com/document/path/99110 ；回调配置（2024-12-13）https://developer.work.weixin.qq.com/document/path/90930 ；错误码（2026-10-29）https://developer.work.weixin.qq.com/document/path/90313
- A8 腾讯云企业微信智能机器人说明（2026-10-27）https://cloud.tencent.com/document/product/1831/134441 ；Kimi 帮助（日期未知）https://www.kimi.com/zh-cn/help/kimi-claw/wecom-bot
- A9 《微信软件许可及服务协议》（日期未知）https://weixin.qq.com/cgi-bin/readtemplate?lang=zh_CN&t=weixin_agreement&s=default
- A10 Wechaty puppet providers（2025-12-21）https://wechaty.js.org/docs/puppet-providers/ ；微信 UI 自动化可行性调研（2026-03-27）https://yage.ai/share/wechat-uia-platform-feasibility-survey-20260327.html
- A11 飞书长连接接收事件（日期未知）https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case ；钉钉 Stream 模式（第三方，日期未知）https://developer.aliyun.com/article/1727311
