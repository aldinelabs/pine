# 微信远程（实验性）

在 Pine 设置 › 远程控制 › 微信中连接自己的个人微信后，可以在微信里给 Pine 发任务：直接发文字交给当前会话，以 `.` 开头的“点命令”查看状态、切换会话、批准卡片和回答问题。通道是腾讯官方的微信 ClawBot（iLink Bot 协议）：Pine 主动向 `ilinkai.weixin.qq.com` 发起 HTTPS 长轮询，不需要公网地址、端口转发或 Aldine 的服务。桌面端和无头服务端共用同一套实现。

本文记录已经实现的结构和规则。调研、决策记录和尚未完成的真机实测（阶段 0）见 [`docs/wechat-remote-plan.md`](../wechat-remote-plan.md)。没有用真实微信账号测试过；所有取决于腾讯服务端的数值都是 `main/wechat/constants.ts` 和 `packages/wechat-ilink/src/constants.ts` 里的具名常量。

## 组成

```text
微信 App ──(腾讯 iLink)── ilinkai.weixin.qq.com / novac2c.cdn.weixin.qq.com
                               ▲ HTTPS 长轮询 / sendmessage（只有出站请求）
packages/wechat-ilink          协议客户端：零运行时依赖，fetch 由外部注入
        ▲
main/wechat/clawbotChannel.ts  适配器：iLink → MessageChannel
        ▲
main/wechat/bridge.ts          WeChatBridge：生命周期、绑定、配对、设置、暂停，组合各模块
   ├─ store.ts                 密封设置 + wechat-remote.json
   ├─ pairing.ts               配对码状态机
   ├─ inbound.ts               接收、去重、落盘、优先通道、串行处理、过期判断、分派
   ├─ outbound.ts budget.ts    回复额度、优先级、合并、发送队列、摘要
   ├─ sessionDirectory.ts      事件缓存、跟踪的会话、审批来源、modeFor、actor、两个提示出口
   ├─ attachments.ts           入站媒体暂存
   ├─ commandSpec.ts parseCommand.ts handles.ts   命令表、解析、编号表
   ├─ asks.ts cardPolicy.ts    待处理编号、审批卡片策略
   ├─ replies.ts text.ts notices.ts               回复模板、纯文本渲染、本机通知文案
   ├─ rateLimit.ts             同一错误不重复发送
   └─ handlers/*.ts            每个命令一个处理器，handlers/index.ts 汇总为 HANDLERS
        ▲                                ▲
main/core/pineCore.ts          main/desktop/wechatHost.ts（仅 Electron：IPC、系统通知、防睡眠）
  持有 core.wechat、事件观察钩子   server/wechatCli.ts（无头服务端：终端绑定、`pine-server wechat …`）
```

- `packages/wechat-ilink`：扫码登录状态机（含 `redirect_host` 切换和验证码）、`getupdates` 游标与退避、`sendmessage`、`sendtyping`、`getconfig`、AES-128-ECB 媒体上传下载、错误码分类（`-14` 需重新扫码）。它不知道 Pine 的会话和审批。实现参照腾讯以 MIT 许可发布的 `@tencent-weixin/openclaw-weixin` 2.4.10，许可证见 `LICENSE-openclaw-weixin`；不依赖该包。
- `main/wechat/` 和 `shared/wechatRemote.ts` 不引入 `electron`（`main/wechat/__tests__/electronFree.test.ts` 检查，`vite.server.config.ts` 构建服务端时也会失败）。
- 微信的设置通道（`WECHAT_REQUEST_CHANNELS`，都以 `wechat:` 开头）只由 `registerWeChatIpc` 注册在桌面 IPC 上，不在 `core.router` 上，也不在网页白名单里（`main/__tests__/webRequestPolicy.test.ts`）。已登录的浏览器和已配对的 Pine Remote 设备都不能绑定、解绑或修改微信设置。
- `PineCore` 构造 `core.wechat`，在 `routeAgentEvent` 的两个分支里调用 `observeAgentEvent`，在子会话启动、会话移动（teleport）和自动化变化时通知桥接器。

## 客户端身份与会话归属

- 桥接器是虚拟客户端 `WECHAT_CLIENT_ID = -2`。每次按项目操作前先 `hold(p)`，即 `runtimes.share(-2, …)`；直接调用 `core.runtimes`、`core.repository`、`core.automations`，从不经过 `core.router`。因此 router 的保护（附件块、模式上限）由桥接器自己再做一遍。
- 项目已被窗口打开时，窗口共享桥接器的运行时；“无项目”（临时工作区）同样可以共享。窗口仍控制自己的会话。
- `actor(session)`：对会话执行操作时使用的客户端 id。依次取 (1) 会话的控制者，只要它不是 `-2`（窗口或浏览器界面）；(2) 活动会话的其他客户端，窗口优先；(3) 新会话或非活动会话：与桥接器共享同一运行时的第一个其他客户端（`clientsSharingRuntime`）；(4) `-2`。回应审批和问卷时用 `responder(session)`：会话的客户端中包含 `-2` 时用 `-2`，否则用 `actor`。
- 新会话由 `startBackgroundSession`（`main/core/requests/sessions.ts`）在后台启动，不抢窗口焦点，会出现在桌面侧栏。从微信启动的会话标为“From WeChat”，微信发过消息的已有会话标为“Used from WeChat”（侧栏图标和会话顶部的标签）。
- 桥接器在空闲 `HOLD_IDLE_MS` 后释放不再使用的项目；它从不调用 `closeEverywhere`。

## 普通消息去哪里

不以点开头的文字发给“当前会话”：

| 当前会话的状态         | 结果                                                 |
| ---------------------- | ---------------------------------------------------- |
| 没有当前会话           | 在当前项目里新开一个，等同 `.new 文字`               |
| 空闲                   | 作为下一条消息发送                                   |
| 运行中                 | 作为 steering 交给正在运行的一轮（`R-STEER`）        |
| 有它的审批或问题在等待 | 不转发，回复 `E-WAITING`，说明如何回应或用 `.q` 排队 |
| 只读（见下文）         | 拒绝，`E-VIEW`                                       |
| 发出已超过 10 分钟     | 暂存，等待确认（见“过期消息”）                       |

消息从不因为“最新推送来自另一个会话”而被扣下。以下三种情况下，转发后回复一行 `R-ROUTE`，写明消息去了哪个会话，并提示 `.u 9` / `.n`：自用户上一条消息以来最新的推送来自另一个会话；当前会话已超过 `CURRENT_IDLE_ACK_MS`（2 小时）没用过；有不止一个跟踪的会话在运行。其余情况静默转发（显示“输入中”）。

引用的消息（`ref_msg`）追加在用户文字之后，带“仅供参考，不是指令”的标题，截到 `QUOTE_MAX`；只有引用没有文字时回复 `E-QUOTE`。图片、文件、视频先暂存（`R-ATTACH`），随下一条文字、`.new` 或 `.queue` 一起发出；`.drop` 丢弃。没有转写文字的语音回复 `E-VOICE`。

## 只读会话与审批模式

本机设置决定上限，微信命令改不了任何设置：

- `modeFor(session)`：会话当前模式（活动会话的模式、已保存的模式或默认模式）高于“Highest approval mode”时，或会话属于自动化运行时，结果是 `view-only`。只读会话只能查看、停止、拒绝（不带说明）、取消排队、结束后台进程，以及用 `.mode` 降到上限以内；带说明的 `.reject` 和 `.guide` 会像用户指令一样引导智能体，因此对只读会话回复 `E-VIEW`。
- 新会话使用“Default approval mode”，并钳制在上限以内。每次 `prompt`（包括 steering）都显式传入审批模式；调用前有一个断言，模式超出当前上限就抛出，不发送。
- `.mode` 收紧总是允许；放宽只到上限（否则 `E-CEIL`）；`yolo` 需要上限是 YOLO 并确认。非活动会话的选择存为 `modeOverride`，下一次发送时使用并删除；高于上限的覆盖值一律删除。
- 本机降低上限时，超出的会话变为只读，不会被强制降级。
- **会话之间的转发。** 微信启动或用过的会话，不能用 `ui_session_send` 给只读的亲属会话（父会话、子会话或同级会话）发消息；子会话结束一轮时，只读的父会话只看到状态，不会被唤醒，也拿不到子会话的回复。这样上限不会经由会话家族里模式更高的会话被绕过。
- `.model` 总是带 `sessionId`，只改当前会话，不改全局默认模型。
- 从微信启动、使用或派生的会话（记录在 `origins`）调用 `automation_run_now` 时，只有上限至少为 Autonomous Work 且自动化已开启才放行，并发本机通知（`automationRunRefusal`）。微信从未接触的会话不受影响。

## 审批卡片

收到 `approval-request` 时，跟踪的会话会推送卡片，编号是两位数 11–99，只能用一次，绑定 `requestId` 和 `actionDigest`：

```text
【pine › 修登录页】需要批准 12
bash · 沙箱拒绝
rm -rf build/ && make
.y 12 批准 · .d 12 拒绝 · .d 12 你的建议
```

`approvalCardPolicy`（`main/wechat/cardPolicy.ts`）决定能否在微信里批准。卡片在微信里的效果与在电脑上相同：任何工具、任何触发原因（执行前确认、沙箱拒绝、授权被拒、Computer Use 授权、`ui_session_delete`、`ui_project_*`、以后新增的工具）默认都可以用 `.y NN` 批准。只有三种例外，在微信里只显示内容、可以 `.d NN` 拒绝：

1. 会话只读（`view-only`）。
2. 高风险：`privileged-execution`（不受沙箱约束的原生执行）和 `destructive-pattern`（危险命令），需要本机打开默认关闭的“Allow approving high-risk actions from WeChat”。打开后批准它们会发本机通知。
3. 自动化的创建、修改、启用审批：与其他远程入口一样，只能在本机批准；`.w` 只显示它们的数量。

其他规则：

- 主题被截断（超过 300 字符）的卡片以 `T-CUT` 结尾，必须先用 `.show NN`（或 `.NN`）看过全文，`.y NN` 才生效（`E-SHOWFIRST`）。没有主题或主题很长的卡片仍可批准，`.show` 分页显示。
- 长上下文卡片（`long-context-activation`）用 `.c NN` 压缩后继续、`.d NN` 停止，`.y` 被拒绝。
- 会话此前读过外部内容（桥接器转入的附件或引用、`web_search`、`web_fetch`、MCP 工具）时，卡片多一行 `T-EXTERNAL`。
- 首个有效回应生效：电脑、Pine Remote 和微信谁先回应算谁；输掉竞争、已作废或已处理的编号回复 `E-DONE`。批准前重新核对：编号仍有效、`actionDigest` 未变、会话不是只读、策略允许、需要时已 `.show`。同一 `requestId` 换了 `actionDigest` 时，旧编号作废，新卡片换一个编号。
- `.y` 不带编号只用于唯一的暂存批次（`ALLOW_BARE_APPROVE = false`）。
- 问题卡片（`ask_user_question`）：`.a NN 2; 1,3; 文字` 按题回答，选项从 1 开始，`=` 开头强制作为自由文本，`.d NN` 取消；带预览或代码、一条回复放不下的问卷只能在 Pine 中回答（`T-QCARD-LOCAL`）。

没有被跟踪的会话的审批也有编号：它们出现在 `.w` 里，`.u` 切过去后可以回应。

## 绑定与配对

只能在桌面窗口或无头服务端的终端里绑定。

1. “Connect WeChat”（或 `--wechat-bind`）调用 `get_bot_qrcode`，对话框显示二维码、倒计时和阶段；微信要求时输入手机上显示的验证码。
2. 手机上确认后，Pine 得到 bot token 和扫码账号，但先只保存在内存里，进入配对阶段：继续轮询，不执行、不转发任何内容。
3. 该账号发来的第一条消息（任意内容，一个点即可）收到 `T-PAIR`：一个 6 位配对码，最多发送 `PAIR_SENDS_MAX`（2）次。这个阶段不发送其他任何内容。
4. 用户在电脑上的对话框（或终端）输入配对码。输错 `PAIR_ATTEMPTS_MAX`（3）次或超过 `PAIR_CODE_TTL_MS`（5 分钟）则结束本次绑定并丢弃 token（`pairing-failed`）。
5. 成功后写入 token 和主人身份，把权限设置重置为默认值（新账号不会继承之前的 YOLO 上限或两个开关），然后发送 `R-WELCOME`。

配对码从手机传到电脑：只看到屏幕或日志的人手机上收不到配对码，在别处扫码的人也无法在本机输入。配对码不写日志，也不发给浏览器界面。

同一个已配对账号重新扫码（例如收到 `-14` 后点“Scan again”）跳过配对，只重置游标、`context_token`、已见消息和收件箱，保留跟踪的会话、当前会话、来源记录和待发队列。已绑定时另一个账号扫码会得到 `account-mismatch`，需先断开。

断开（“Disconnect”，或 `pine-server wechat unbind`）：中止只有桥接器持有的运行中会话，释放桥接器持有的项目，清除 token 和主人，把上限、默认模式和两个开关恢复默认。确认对话框会说明这些。

## 设置与状态文件

| 文件                                   | 内容                                                                                                                       | 保护                                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `<dataDirectory>/wechat-remote-secure` | 密封数据：bot token、主人身份（用户 id、bot id、`baseUrl`、绑定时间）、权限设置、`paused`                                  | 经 `host.credentialStorage` 写入，权限 `0600`；桌面端用系统钥匙串加密，无头服务端不加密 |
| `<agentDirectory>/wechat-remote.json`  | 游标、已见消息、收件箱、当前会话与项目、跟踪的会话、来源记录、`modeOverride`、编号与待处理项、待发队列、暂存附件、回复语言 | 权限 `0600`；不决定权限                                                                 |
| `<dataDirectory>/wechat-inbox/`        | 下载后尚未发给会话的入站媒体                                                                                               | 目录 `0700`；使用时移入项目的附件目录                                                   |

- 上限、两个开关、`paused` 和主人身份只从密封数据读取。密封数据无法解析或解密时，桥接器以默认设置启动并暂停，发本机通知（`settings-reset`）。
- 密封数据的写入先从磁盘重新读取再修改，所以运行中的服务端不会覆盖离线时 `pine-server wechat config` 做的改动。
- “Receive tasks from WeChat”、托盘的“WeChat remote”开关和 `.pause` 写的是同一个 `paused`。恢复只能在本机：设置页、托盘，或 `pine-server wechat config --resume`。
- `origins` 和 `modeOverride` 在普通状态文件里。篡改 `origins` 最多让 `.delete` 删到另一个会话或隐藏标记；`modeOverride` 在使用时钳制。

## 入站处理

`MessageChannel.onMessages` 只做接收和落盘，不处理命令、不下载媒体：

1. 接收检查（见安全不变量 1），不符合的消息静默丢弃。
2. 记下 `context_token`，续上回复额度。
3. 配对阶段：交给配对流程，到此为止。
4. 已暂停：每 `PAUSED_NOTICE_INTERVAL_MS`（10 分钟）最多回复一次 `E-PAUSED`，到此为止。
5. 游标、已见消息和新的收件箱条目在一次写入中落盘，然后才继续轮询。

`.stop`、`.pause`、`.reject`、`.guide`、`.kill` 走优先通道立即执行；其余按到达顺序进入串行队列：标记开始 → 过期判断 → 下载并暂存媒体（`FILE_MAX_BYTES`、`MEDIA_DOWNLOAD_TIMEOUT_MS`）→ 解析与分派 → 发送回复（前面带上待发摘要）→ 删除收件箱条目。Pine 重启后，未开始的条目照常处理；已开始但没处理完的条目，只读命令和只降低风险的命令（M−）重新执行，普通文字、`.new`、`.queue 文字` 和已确认的 D 命令不重跑，统一用一条 `T-INTERRUPTED` 列出。

处理器抛出的 `WeChatRefusal` 按模板回复；Pine 的已知错误映射为对应回复（例如“no longer pending”→ `E-DONE`，会话在别的窗口 → `E-OTHERWIN`）；其他异常回复 `E-FAIL`，详情只记在本机日志里，不含任何密钥。

### 过期消息

`create_time_ms` 距今超过 `STALE_MS`（10 分钟），或缺失、为 0、不是有限数、比本地时钟超前 `FUTURE_SKEW_MS`（2 分钟）以上，都算过期。每个命令有一个过期类别：

| 类别    | 命令                                                                              | 过期时                                                        |
| ------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `run`   | `.pause`                                                                          | 照常执行                                                      |
| `guard` | `.stop`、`.kill`、`.reject` / `.guide`、`.unqueue`、`.auto N off`、收紧的 `.mode` | 只有目标在消息写下时已经存在才执行                            |
| `hold`  | 普通文字、`.new`、`.queue 文字`                                                   | 暂存为一个批次，`.y NN` 按顺序执行，`.d NN` 丢弃，10 分钟有效 |
| `drop`  | 其余命令，包括所有读取、`.approve`、`.answer`、`.model`、`.file`、`.delete`       | 不执行，列为“未执行”                                          |

一次唤醒里的所有过期消息合并为一条 `T-STALE`。

## 命令

命令以 `.`、`。`、`．` 或 `｡` 开头，名称不分大小写、做 NFKC 归一化；中文别名可以直接接文字（`.新修一下登录页`）。规则：

- 只有一个点 = `.status`；`.?` = `.help`；`.0` = `.more`。
- `.N`：按最后一次送达的列表选第 N 行（`.u`、`.p`、`.m`、`.o`、`.task` 等），`.9` = 最新推送的会话，`.11`–`.99` = `.show`。问题卡片开着时 `.2` 可以作为回答，但有歧义时回复 `E-AMBIG` 而不猜。裸数字从不映射到 `.delete`、`.kill`、`.unqueue`、`.auto N on|off|run`。
- 以点开头的普通文字用两个点发（`..env 没提交` → `.env 没提交`）。三个以上的点、点后接空格、`.5倍`、`./run.sh` 之类照常作为普通文字。
- 看起来像命令却不认识的（`.statsu`、`.gitignore`）不会发给智能体，回复 `E-UNKNOWN` 并给出建议。
- 列表每页最多 8 行，编号 1–8，`.more` 翻页；编号 30 分钟后失效（`E-REF`）。推送从不替换列表编号。
- 多余的参数是 `E-ARGS`，从不忽略。

类别：R 只读；R+ 会把会话内容经腾讯发出；M− 只降低活动或风险，只读会话也可用；M 在现有限制内修改；D 不可逆或发出文件，需要确认或本机开关。“当前”表示需要当前会话（否则 `E-NOSESSION`）。

| 命令        | 别名                                         | 参数                   | 类别  | 作用                                                                              |
| ----------- | -------------------------------------------- | ---------------------- | ----- | --------------------------------------------------------------------------------- |
| `.help`     | `.h` `.?` `.帮助`                            | `[命令 \| 2]`          | R     | 常用命令；`2` 其余命令；命令名给出用法                                            |
| `.status`   | `.` `.s` `.st` `.状态`                       | —                      | R     | 当前会话状态、待处理项、其他运行中的跟踪会话                                      |
| `.info`     | `.cfg` `.about` `.version` `.设置` `.关于`   | —                      | R     | 电脑名、Pine 版本、上限、默认模式、两个开关、回复语言                             |
| `.lang`     | `.语言`                                      | `zh \| en \| auto`     | M     | 回复语言                                                                          |
| `.pause`    | `.暂停`                                      | `[all]`                | M−    | 暂停；`all` 先停止所有运行中的跟踪会话。只能在本机恢复                            |
| `.more`     | `.0` `.更多` `.下一页`                       | —                      | R     | 下一页                                                                            |
| `.drop`     | `.clear` `.丢弃`                             | —                      | M−    | 丢弃暂存的附件                                                                    |
| `.new`      | `.n` `.新` `.新建`                           | `[@项目] [文字]`       | M     | 新开会话；不带文字则下一条消息开新会话。有待处理项时 `.n` 不带文字回复 `E-NGUARD` |
| `.sessions` | `.l` `.ls` `.会话` `.列表`                   | `[@项目]`              | R     | 最近的会话                                                                        |
| `.search`   | `.f` `.find` `.搜` `.搜索`                   | `关键词`               | R+    | 全文搜索所有会话                                                                  |
| `.use`      | `.u` `.sw` `.切换` `.接管`                   | `[编号或名称]`         | M     | 切换当前会话并跟踪它，不发送任何内容；附上它待处理的卡片                          |
| `.last`     | `.r` `.result` `.结果`                       | —                      | R+    | 当前。最后一轮回复，分页                                                          |
| `.history`  | `.hi` `.hist` `.历史`                        | `[n]`                  | R+    | 当前。最近 n 轮（默认 3，最多 10）                                                |
| `.stop`     | `.x` `.停` `.停止`                           | `[all]`                | M−    | 当前。停止运行；`all` 停止所有跟踪的会话                                          |
| `.queue`    | `.q` `.排队` `.稍后`                         | `[文字]`               | M     | 当前。这一轮结束后再发；不带文字列出排队消息                                      |
| `.unqueue`  | `.qx` `.撤回`                                | `[N]`                  | M−    | 当前。撤回排队的消息                                                              |
| `.rename`   | `.rn` `.重命名` `.改名`                      | `标题`                 | M     | 当前。重命名                                                                      |
| `.delete`   | `.del` `.删除`                               | `编号或名称`           | D     | 删除从微信新建的会话，需 `.y NN` 确认                                             |
| `.model`    | `.m` `.models` `.模型`                       | `[编号或名称]`         | M     | 列出模型，或切换当前会话的模型                                                    |
| `.effort`   | `.e` `.推理` `.思考`                         | `[N \| 级别]`          | M     | 当前。推理强度                                                                    |
| `.mode`     | `.mo` `.模式`                                | `[N \| 模式]`          | M     | 当前。审批模式，不超过上限；`yolo` 需确认                                         |
| `.usage`    | `.i` `.ctx` `.cost` `.用量` `.上下文`        | —                      | R     | 当前。上下文和费用                                                                |
| `.compact`  | `.c` `.压缩`                                 | `[NN]`                 | M     | 当前。压缩上下文，或回应长上下文卡片                                              |
| `.todo`     | `.t` `.todos` `.待办`                        | —                      | R+    | 当前。智能体的待办                                                                |
| `.pending`  | `.w` `.approvals` `.待处理`                  | —                      | R+    | 所有待处理的审批和问题，以及本机待批的自动化变更数                                |
| `.show`     | `.详情` `.NN`                                | `NN`                   | R+    | 卡片全文                                                                          |
| `.approve`  | `.y` `.yes` `.ok` `.批准` `.同意` `.确认`    | `[NN]`                 | M     | 批准卡片、确认或执行暂存批次                                                      |
| `.reject`   | `.d` `.no` `.deny` `.cancel` `.拒绝` `.取消` | `[NN] [说明]`          | M−    | 拒绝（带说明即指导，只读会话不接受说明）、取消问题、丢弃确认或批次                |
| `.guide`    | `.g` `.指导` `.建议`                         | `[NN] 说明`            | M−    | 拒绝并附上说明（只读会话回复 `E-VIEW`）                                           |
| `.answer`   | `.a` `.ans` `.回答` `.答`                    | `[NN] 答案`            | M     | 回答问题卡片                                                                      |
| `.files`    | `.o` `.out` `.文件` `.产物`                  | `[N]`                  | R     | 当前。智能体展示过的文件                                                          |
| `.file`     | `.send` `.发送`                              | `N`                    | D     | 当前。发送一个展示过的文件，需本机开关                                            |
| `.tasks`    | `.b` `.bg` `.后台` `.进程`                   | —                      | R+    | 当前。后台进程                                                                    |
| `.task`     | `.输出`                                      | `N`                    | R+    | 当前。进程最近的输出                                                              |
| `.kill`     | `.k` `.bx` `.结束`                           | `N`                    | M−    | 当前。结束一个后台进程                                                            |
| `.projects` | `.p` `.project` `.proj` `.项目`              | `[编号或名称]`         | M     | 列出项目，或设为新会话的项目                                                      |
| `.autos`    | `.au` `.自动化`                              | `[@项目]`              | R     | 自动化列表                                                                        |
| `.auto`     | —                                            | `N [on \| off \| run]` | M / D | 详情；`off` 关闭；`on` 在电脑上发起开启请求；`run` 立即运行                       |
| `.runs`     | `.ar` `.运行记录`                            | `[N]`                  | R+    | 运行记录及摘要                                                                    |
| `.skills`   | `.sk` `.技能`                                | —                      | R     | 当前项目的 Skills                                                                 |
| `.mcp`      | `.工具服务`                                  | —                      | R     | MCP 服务器名称、范围、状态、工具数                                                |

`main/wechat/commandSpec.ts` 是这张表的唯一来源，解析器、`.help` 和测试都由它生成；`handlers/__tests__/registry.test.ts` 保证每个命令都有处理器。

### 何时被拒绝

- 只读会话：普通文字、`.queue 文字`、放宽的 `.mode`、`.approve`、`.answer`、`.model N`、`.effort N`、`.compact`、`.rename`、`.delete` 被拒绝（`E-VIEW`，自动化运行为 `E-VIEWRUN`）；读取、停止、拒绝、取消排队、结束进程、`.auto N off`、收紧的 `.mode` 仍可用。
- `.delete`：只删除从微信新建的会话（只是用过的会话 `E-NOTOWN`），运行中或有待处理项时 `E-BUSY`，之后在电脑上运行过的也 `E-BUSY`，需要确认。只删除该会话本身。
- `.file`：需要“Allow sending files to WeChat”（否则 `E-SWITCH`，且从不请求 `getuploadurl`）；只发展示过的文件，发送时真实路径必须与记录相同、仍是文件且不超过 100 MB。发送后有本机通知。
- `.auto N run`：上限至少为 Autonomous Work（否则 `E-CEIL`），自动化已开启（否则 `E-AUTOOFF`），未在排队或运行，需要确认，有本机通知。`.auto N on` 不直接开启，只在电脑上发起一个标注“Requested from WeChat”的审批，不等待结果；无头服务端没有本机审批界面，回复 `E-LOCAL`。
- `.mode yolo`：上限必须是 YOLO，确认文字带上 YOLO 警告，有本机通知。
- 暂停时一切都被丢弃。

Pine 不对绑定账号做使用频率限制：没有每小时新会话数、同时运行数或 `.auto N run` 次数之类的上限。限制只针对腾讯一侧：回复额度、`ret` 非 0 时退避排队，以及同一条错误回复在 `ERROR_REPEAT_MS`（30 秒）内不重复发送。

不提供：创建、编辑、删除项目或输入任意路径；文件树和按路径发文件；修改 Pine 设置或微信设置、恢复暂停、解绑、远程控制配对、浏览器访问；自动化的创建与编辑；Skill 和 MCP 的编写；提供商登录和密钥；全局默认模型；窗口和标签操作。语音、引用、转发和文件名里的文字从不作为命令。

## 回复额度与推送

社区实测每条入站消息之后大约能回复 10 次（`BUDGET`），桥接器只用 `USABLE`（8）次，最后一次留给 `T-BUDGET`（每个 token 一次）。新的入站消息续上额度。

| 优先级 | 内容                                           | 发送条件                                                             |
| ------ | ---------------------------------------------- | -------------------------------------------------------------------- |
| P0     | 命令回复、错误、开始和 steering 确认、过期摘要 | 只要还剩额度                                                         |
| P1     | 跟踪会话的审批和问题卡片                       | 剩余 ≥ 2；2 秒内的卡片合并，每条最多 3 张，其余用 `T-MORECARDS` 提示 |
| P2     | `T-DONE` / `T-FAILED`                          | 剩余 ≥ 2；只针对桥接器发出最新提示的那一轮                           |
| P3     | `T-PROGRESS`                                   | 剩余 ≥ 5；每轮最多一次，运行超过 `PROGRESS_AFTER_MS`（10 分钟）后    |
| P4     | `T-AUTORUN`、`T-AUTO-ON`、`.compact` 的第二条  | 剩余 ≥ 4                                                             |

- 跟踪的会话（最多 `TRACKED_MAX` = 20）：从微信启动的、用 `.use` 选过的、以及它们派生的子会话。派生的子会话只推送卡片。用 `.use` 选过的会话在出现一轮不是桥接器发起的运行时，或闲置 `TRACK_IDLE_MS`（24 小时）后不再跟踪；再发消息会重新跟踪。
- 发不出去的推送进入 `outQueue`（最多 20 条，持久化）：卡片在审批决定或运行结束时移除，同一会话的结果只保留最新一条。用户下一条消息的回复前面加一段 `T-DIGEST`。
- `sendmessage` 返回非 0 时，当前 token 视为用尽，不重试，等下一条入站消息；`-14` 停止一切发送，发本机“需要重新扫码”通知。
- 单条回复最多 `REPLY_MAX`（1 800）字符，更长的内容分页，从不拆成多条发送。纯文本，去掉 Markdown；来自智能体、文件、标题和搜索片段的行会去掉控制字符，并在行首的点前加空格，使它们不能被直接复制成命令。绝对路径只显示文件名。

推送从不替换列表编号；`.u 9`（或 `.9`）是最新推送所属的会话，30 分钟有效。

## 本机通知

以下事件总会弹出系统通知，不受注意力通知开关影响：从微信启动会话、已有会话第一次被微信使用、从微信批准高风险操作、向微信发送文件、从微信删除会话、从微信运行自动化、会话从微信切到 YOLO、需要重新扫码、微信远程被暂停、设置被重置。无头服务端把它们写进日志。

## 安全不变量

每条都有测试：`main/wechat/__tests__/security.test.ts` 为每条不变量各有一个具名测试，并用真实组件断言；各模块自己的测试也覆盖相应部分。

1. **接收。** 只处理满足以下全部条件的消息：有消息 id；是用户消息；`from_user_id` 等于主人；`to_user_id` 缺失或等于本 Bot；`group_id` 为空；id 没有处理过。其余静默丢弃。时间戳缺失、为 0、不是有限数或超前过多的消息一律视为过期。
2. 只解析用户亲手输入的文本条目。语音转写作为普通消息；引用追加在用户文字之后、带标签并截断，从不放在最前面，也从不单独转发；文件名只是显示数据。
3. 每个提示都经 `SessionDirectory.startSession` 或 `send` 发出。`core.startBackgroundSession` 和 `runtimes.prompt` 之前的断言检查显式审批模式在**当前**上限以内。`view-only` 挡住所有修改路径（包括带说明的拒绝，以及经 `ui_session_send` 或子会话轮次报告转给只读亲属会话）；高于上限的 `modeOverride` 被删除，从不传出。
4. 以下情况从不调用 `respondApproval(approve)`：策略判为不可批准的卡片、只读会话、过期消息、已作废的编号、`actionDigest` 变化、主题被截断且 `.show NN` 尚未送达（完整主题须在本次拉取开始前发出，且比消息的 `create_time_ms` 早 `ASK_SKEW_MS` 以上）。
5. “Allow sending files to WeChat”关闭时从不请求 `getuploadurl`。文件只从展示过的文件表发送，且真实路径必须仍等于记录的路径。
6. 微信命令从不写入微信设置、Pine 设置、凭据或项目文件夹。暂停后只能在本机恢复。
7. `core.router` 上没有 `wechat:*` 通道，`createWebChannels` 里也没有。
8. 每个请求的 URL 先经过 `allowUrl`，并且不跟随任何 HTTP 重定向（API、二维码、CDN 下载、CDN 上传）。默认的 `defaultAllowUrl` 只放行 https、无用户信息、默认端口、非 IP 字面量的主机，API 限 `*.weixin.qq.com`，CDN 另允许 `*.qq.com`。保存的 `owner.baseUrl` 每次启动都重新检查。
9. 来自智能体、文件或标题的行在发送前经过中和处理。
10. **附件块。** 用户文字（普通文字、语音转写、`.new` 和 `.queue` 的文字）只要能被 `parseAttachmentMessage` 解析出附件，或去掉开头空白后以附件块标记开头，就以 `E-TEXT` 拒绝。最终消息只由 `serializeAttachmentMessage(staged, body)` 生成，桥接器再解析一遍，要求路径列表与 `InboundAttachments.take` 返回的完全相同，否则抛出、不发送。
11. **绑定。** 在电脑上输入发到微信的配对码之前，来自微信的内容一概不执行、不转发，除配对码外不发送任何回复。无头服务端只在终端上绑定，从不自动批准。
12. **密封设置。** 上限、两个开关、`paused` 和主人身份只从密封数据读取；读不出来时以默认设置启动并暂停，发本机通知。
13. **自动化。** `origins` 里的会话只有在上限至少为 Autonomous Work 且自动化已开启时才能通过 `automation_run_now` 启动自动化；`.auto N run` 有同样两个条件，另需确认。

## 待阶段 0 实测的常量

以下数值只来自腾讯的开源代码或社区报告，真机实测后可能调整：

- 回复额度：`BUDGET = 10`、`USABLE = 8`、`MERGE_WINDOW_MS = 2000`、`REPLY_MAX = 1800`（`main/wechat/constants.ts`），以及 `ret = -2` 是否表示额度用尽。
- 大小与超时：`FILE_MAX_BYTES` / `MEDIA_MAX_BYTES` = 100 MB、`MEDIA_DOWNLOAD_TIMEOUT_MS = 60 s`、`CDN_IDLE_TIMEOUT_MS = 30 s`、`TEXT_CHUNK_LIMIT = 4000`。
- 协议：`LONG_POLL_TIMEOUT_MS = 35 s`、`STALE_TOKEN_CODE = -14` 与 `STALE_TOKEN_PAUSE_MS = 1 h`、退避 `RETRY_DELAY_MS` / `RETRY_LONG_DELAY_MS` / `RETRY_LONG_AFTER`、`channel_version` 带宿主后缀是否被接受、`API_HOST_SUFFIX` / `CDN_HOST_SUFFIXES` 是否覆盖实际主机、CDN 是否会重定向（重定向会被拒绝）（`packages/wechat-ilink/src/constants.ts`）。
- 时钟：`ALLOW_BARE_APPROVE = false`、`ASK_SKEW_MS = BARE_GAP_MS = 5000`，在比较过腾讯的 `create_time_ms` 与本地时钟之后才可能放开不带编号的 `.y`。
- bot token 的有效期、离线期间服务端是否按游标保留消息、代理或海外出口是否被拦截。

## 开发与验证

- `packages/wechat-ilink/src/testing` 导出 `startMockIlink()`：一个本地 iLink mock 服务器，支持扫码登录各阶段、推送用户消息、记录请求和模拟错误码。默认账号的 token 是 `mock-bot-token`。
- 产品里没有把桥接器指向 mock 服务器的开关（环境变量覆盖 API 主机就等于绕过 `allowUrl`）。测试经 `WeChatBridgeOptions.channels` 注入 `createClawBotChannels({ fetch, version, apiBaseUrl, cdnBaseUrl, allowUrl: () => true })`。
- `main/wechat/__tests__/fakes.ts` 提供假的核心、通道、存储和附件（`createTestContext()` 等），处理器测试在 `main/wechat/handlers/__tests__/`。
- `main/wechat/__tests__/e2e.test.ts` 用真实的 `WeChatBridge`、mock iLink 服务器上的 ClawBot 通道、`ProjectRuntimeRegistry` 和临时项目目录跑完整场景（绑定与配对、`.new` → 审批卡片 → `.y NN` → 完成推送、回复额度、token 过期、过期消息、附件块拦截等），共用的搭建代码在 `e2eHarness.ts`。
- 运行：在 `apps/desktop` 下 `bun run test:run src/main/wechat`；协议包 `bun run --filter @pine/wechat-ilink test:run`；`bun run build:server` 确认服务端构建没有引入 `electron`。

## 已知限制

- 腾讯服务端的规则没有公开文档，上面的常量都是假设；Pine 作为非 OpenClaw 宿主的合规身份未获腾讯确认，功能标为实验性。
- 只有 Pine 运行且电脑未睡眠时才能收到消息。“Keep the computer awake while WeChat is on”挡不住合盖睡眠。
- 配对需要先成功发出一条 `sendmessage`。如果腾讯拒绝第三方宿主发送，绑定无法完成，这也是最早能发现这个问题的地方。
- 媒体在内存中缓冲：发送 100 MB 的文件约占用 200 MB。
- 向已有会话发消息会调用 `resume`，即使 `focus: false` 也会改变运行时的聚焦会话，窗口里的 MCP 状态可能跟着微信会话变化。
- 读取范围：默认设置下，绑定的账号可以读到所有项目的会话标题、搜索片段、回复、历史、待办和进程输出。设置页的说明写明了这一点。
- 没有针对微信会话的费用上限；`.model` 可以选最贵的模型。
- 密封数据在桌面端由系统钥匙串加密；在无头服务端只是 `0600` 的明文文件，边界是数据目录的文件权限。
- `.delete` 只删除会话本身，不删除它的子会话。窗口里仍打开该会话的标签只通过会话库变化得知，之后显示 Pine 对已删除会话的现有状态。
- 非活动的只读会话用 `.mode` 收紧时，选择存为 `modeOverride`，但在会话再次活动之前它仍显示为只读。
- 点击微信相关的系统通知只会把持有该项目的窗口带到前台，不会打开对应会话。
- 无头服务端：`pine-server wechat config --language` 写在普通状态文件里，运行中的服务端在收到 `SIGHUP` 之前的下一次普通写入（例如游标）可能把它覆盖。可靠的方式是在微信里用 `.lang`，或在服务端停止时修改。
