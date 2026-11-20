# Pine 多用户（Multiple users）设计提案

> 状态：提案，待确认，尚未实施
> 范围：桌面端（macOS / Windows）同一系统账户、同一份 Pine 安装下的多个 Pine 用户；headless server 不变

## 1. 目标与非目标

目标：

- 一家人共用一台电脑的同一个系统账户时，每个人有自己的 Pine：会话、项目、记忆、模型连接、个性化设置互不混在一起。
- 设置里新增「多用户」（Multiple users）分区，可以新建、改名、选头像和颜色、删除用户。
- 有两个及以上用户时，启动先显示「谁在使用 Pine？」（Who's using Pine?）。
- 只有一个用户时体验与 0.22.0 完全一致：没有选择界面，侧边栏没有新入口。
- 现有数据零移动、零丢失，可随时降级回 0.22.0。

非目标：

- 不是安全边界。同一系统账户下的所有文件对每个家庭成员都可读，`safeStorage` 的密钥也是同一把。第一版不做密码或 PIN。
- 不支持两个用户同时运行（同一时刻只有一个活动用户）。
- 不让非活动用户的后台任务（自动化、微信遥控）在后台继续跑。

命名：代码里已经有 `userProfile`（设置 › 个性化 里的称呼、沟通风格、工作方式），为避免混淆，本功能内部统一叫 **user**（`PineUser`、`users.json`），界面叫「用户」/ "user"，不叫 profile。

## 2. pi 本身提供什么

核对 `node_modules/@earendil-works/pi-coding-agent@1.5.2` 与 `pi-ai@1.5.2` 源码：

- pi **没有**命名 profile 的概念，没有 profile 列表、切换 API 或 per-profile 的 auth。
- 唯一的机制是「换一个 agent 目录」：`config.js` 的 `getAgentDir()` 读 `PI_CODING_AGENT_DIR`，默认 `~/.pi/agent`；`auth.json`、`models.json`、`settings.json`、`sessions/`、`themes/`、`tools/`、`bin/`、`prompts/` 都在这个目录下。`SettingsManager.create(cwd, agentDir)`、`PiModelRuntime.create({ authPath, modelsPath, modelsStorePath })` 都接受显式路径。
- Pine 从不使用 pi 的默认目录：所有 pi 调用都显式传 `<userData>/agent`（`PineCore.agentDirectory`，`model-service.ts` 里 `authPath: <agentDir>/auth.json`）。唯一读 `~/.pi/agent` 的是「Pi 提供商」导入（`agent/runtime/pi-providers.ts`，顺序：Pine 设置 › `PI_CODING_AGENT_DIR` › `~/.pi/agent`），那是用户自己装的 pi CLI，属于系统账户级别。

结论：多用户完全由 Pine 实现，做法就是给每个 Pine 用户一个独立的数据根目录（其中自然包含独立的 pi agent 目录）。不需要改 pi，也不需要设置 `PI_CODING_AGENT_DIR`。

## 3. 现有数据清单与归属

`<userData>` = `app.getPath("userData")`（macOS `~/Library/Application Support/Pine`）。

| 数据 | 位置 | 归属 | 说明 |
| --- | --- | --- | --- |
| Pine 设置（模型选择、审批、压缩、`userProfile`、`quickComposerEnabled`、`runInBackground`、`webServer` 等） | `agent/pine-settings.json` | 每用户 | |
| 模型凭据（API key / OAuth） | `agent/auth.json`（pi 格式） | 每用户，新建时可复制 | 家庭常共用一个付费 key，见 §7 |
| 自定义模型与提供商 | `agent/models.json`、`models-store.json`、`decisions-models.json`、`video-models.json` | 每用户，随凭据一起复制 | |
| pi settings | `agent/settings.json` | 每用户 | |
| MCP 服务器 | `agent/mcp.json` | 每用户 | |
| 全局技能 | `agent/skills/` | 每用户 | |
| 全局记忆 | `agent/memory/` | **每用户（最关键）** | 内容是关于“这个人”的事实 |
| 浏览器访问 / Remote Control 配对 | `agent/web-access.json`、`agent/remote-control.json` | 每用户 | 同一时刻只有活动用户的在运行 |
| 微信遥控绑定 | `agent/wechat-remote.json`、`wechat-remote-secure`、`wechat-inbox/` | 每用户 | 同上 |
| TinyFish key | `tinyfish-api-key`（`safeStorage`） | 每用户，新建时可复制 | |
| 项目、会话、项目记忆、自动化与其密钥、Live Context 转写、附件、artifact 版本、side chats、tmp | `projects/<id>/…` | 每用户 | No-Project（`00000000-…-0001`）也在这里，因此 No-Project 记忆自然每用户 |
| 界面偏好（主题、语言、货币、标签页、侧边栏、收藏模型、未读） | `ui-preferences.json`（主进程 `PreferenceStore`） | 每用户 | 启动界面读上次用户的主题和语言 |
| 大致位置缓存 | `approximate-location.json` | 每用户（跟随数据根，最省事） | |
| 旧版 `recent-projects.json` | 根目录 | 不动 | 当前代码已不读 |
| Chromium 存储：Local Storage、IndexedDB、Session Storage、Cookies、各类 GPU/Code Cache | 根目录 | 共享 | 见 §8 风险 1 |
| 日志 | `app.getPath("logs")` | 共享 | 诊断事件加 `userId` |
| Computer Use 支持目录、桥接 socket、光标 app、Chrome 扩展、native-messaging host | `…/Pine/computer-use/`（硬编码，不随 userData） | 共享 | 机器级安装，一份即可 |
| 说话人模型 | 随 app 打包 | 共享 | |
| 应用更新、托盘、Dock、全局快捷键、Windows 沙箱账户 | 进程级 | 共享，行为归活动用户 | |
| 窗口位置 | 不持久化 | — | |

结论：除 Chromium 存储、日志、computer-use 和进程级资源外，Pine 的状态都挂在 `host.dataDirectory` 和 `ui-preferences.json` 两个入口下。这就是切分点。

## 4. 数据布局

```text
<userData>/
├── users.json                 # 新增：用户列表（只有在新建第二个用户时才创建）
├── agent/  projects/  ui-preferences.json  tinyfish-api-key  wechat-*  …
│                              # 原样不动，属于「原始用户」（id: "primary"）
└── users/
    └── <user-id>/             # 之后新建的用户，内部结构与根目录相同
        ├── agent/
        ├── projects/
        ├── ui-preferences.json
        └── …
```

关键决定：**原始用户的数据留在原地，不迁移到 `users/default/`。**

- 无损：不复制、不移动任何文件，不存在迁移到一半失败的状态。
- 可逆：删掉 `users.json` 和 `users/` 就回到 0.22.0；降级到 0.22.0 时它只看根目录，原始用户的一切都在。
- 代价是布局不对称；原始用户不能被删除（可以改名、换头像）。已核对没有代码扫描整个 userData 根目录（项目只扫 `projects/*/project.json`），新增的 `users/` 不会被误读。

`users.json`：

```json
{
  "version": 1,
  "users": [
    { "id": "primary", "name": "Xinyuan", "avatar": "🌲", "color": "green", "createdAt": "…" },
    { "id": "<uuid>", "name": "Mom", "avatar": null, "color": "amber", "createdAt": "…", "lastUsedAt": "…" }
  ],
  "lastUserId": "primary",
  "askAtLaunch": true
}
```

- 同目录临时文件 + rename 原子写；解析失败时视为单用户（只用原始用户），不覆盖坏文件，日志记录。
- 原始用户的默认名称取 设置 › 个性化 的称呼（`userProfile.nickname`），为空时用「我」/"Me"。
- `avatar` 是一个 emoji（从固定的一组里选），为空时显示名字首字；`color` 是固定色板中的 token，暗色模式各有对应值。
- 用户 id 用 UUID，目录名只用 id，不用名字，改名不动目录。

## 5. 主进程如何按用户划分

现在启动顺序是 `ready → PineCore.create(desktopHost()) → createWindow()`。改为：

1. `ready` 后先读 `users.json`，决定活动用户（见 §6）。
2. 得到 `dataRoot`（原始用户 = `userData`，其他 = `userData/users/<id>`）后再创建 `PreferenceStore(dataRoot/ui-preferences.json)` 和 `PineCore.create({ ...desktopHost(), dataDirectory: dataRoot })`。`PineCore` 内部全部从 `host.dataDirectory` 派生（`agent/`、`projects/`、TinyFish、微信、位置缓存），不需要逐个服务改造。
3. 现在在模块顶层创建、早于 `ready` 的 `PreferenceStore` 需要推迟到用户确定之后；依赖它的 IPC（偏好快照是 `sendSync`）在选择界面阶段返回选择界面专用的一份（主题、语言取上次用户的偏好）。
4. `app.getPath("userData")` 本身不改（Chromium 已在 `ready` 前锁定它），只改 Pine 自己的数据根。
5. 需要显式处理的两处共享 Chromium 存储：
   - `adoptWebStoragePreferences()` 会把旧版本留在 localStorage 里的偏好搬进主进程。只允许原始用户执行，否则新用户会继承原始用户的旧偏好。
   - `preferenceStorage` 在主进程不可用时回退到 `window.localStorage`；多用户下这条回退要关掉或加用户前缀。

### 切换用户：重启，而不是热切换

切换 = 走现有的退出确认（有运行中的会话、Remote Control、微信遥控时提示），然后 `app.relaunch({ args: [...argv, "--pine-user=<id>"] })` + `app.quit()`。

不做热切换的原因：`PineCore` 持有 agent utility process、自动化定时器、微信长轮询、本地 web server 端口、Remote Control、全局快捷键、文件监听、`safeStorage` 读出的密钥缓存；各窗口的 Pinia store、路由和 `ui-preferences` 也都假定进程内只有一个数据根。这些从没被设计为可在同一进程里销毁再重建，漏掉任何一个都会出现“B 的界面里冒出 A 的数据”。重启约 1–2 秒，换来的是不可能串数据。

## 6. 启动流程与选择界面

```text
ready
 ├─ 没有 users.json，或只有 1 个用户 ──────────────► 直接以该用户启动（与今天相同）
 ├─ 命令行带 --pine-user=<id>（来自切换） ─────────► 直接以该用户启动
 ├─ askAtLaunch = false 且 lastUserId 有效 ───────► 直接以上次用户启动
 └─ 否则 ────────────────────────────────────────► 「谁在使用 Pine？」
```

选择界面：

- 一个独立的、尺寸同项目列表窗口的窗口，使用同一份 renderer（`#/who` 路由）和窄化的 preload API：只有 `listUsers`、`chooseUser`、`addUser`，此时 `PineCore` 尚未创建，renderer 拿不到任何用户数据。
- 居中标题「谁在使用 Pine？」；下面一排头像磁贴（圆形头像 + 名字），最后是虚线「添加用户」磁贴。磁贴多于一行时换行，不滚动。
- 键盘：方向键 / Tab 移动焦点，Enter / 空格进入；`1`–`9` 直接选第 N 个；默认焦点在上次使用的用户上。
- 选择后同一窗口过渡到该用户的主界面（主进程此时创建 `PineCore`，窗口重新加载到正常路由），不闪新窗口。
- 底部一行小字复选框「在这台电脑上记住我的选择」；勾选后写 `askAtLaunch: false`，以后直接进入上次用户。回到选择界面的方法：任何「切换用户」入口，或在 设置 › 多用户 打开「打开 Pine 时询问是谁在使用」。
- 在选择界面添加用户只填名字、头像和颜色；复制模型连接等选项只在设置里提供（选择界面里没有用户上下文可复制）。
- 主题和语言用上次用户的偏好；没有时跟随系统。
- 托盘、Dock 点击、第二实例、快速输入框快捷键在选择界面阶段只把选择窗口拉到前面。

切换入口（只有多于一个用户时出现）：

- 侧边栏底部：在设置按钮旁显示当前用户的小头像；点击弹出菜单，列出其他用户（点即切换）和「管理用户…」（打开 设置 › 多用户）。
- macOS 应用菜单 / Windows 托盘菜单：「切换用户」子菜单，第一行显示当前用户名。
- 不新增全局快捷键，避免和现有快捷键冲突。

## 7. 设置 › 多用户

分区放在「个性化」之后、「项目」之前，图标 `UsersRoundIcon`。单用户时也显示这个分区，但只有一行“你”和「添加用户」按钮，不在别处出现任何新东西。

内容：

- 顶部说明：「每个用户有自己的对话、项目、记忆和模型连接。用户之间不设密码，能使用这台电脑账户的人都能打开任何一个用户。」
- 用户列表（`Item` 行）：头像、名字、“当前”标记、上次使用时间；行尾「编辑」与「…」菜单（切换到此用户 / 删除）。
- 「添加用户」按钮 → 对话框：名字（必填，≤40 字符，不能与现有重名）、头像 emoji 网格（约 16 个）、颜色色板（8 个）、复选框「复制我的模型连接」（复制 `auth.json`、`models.json`、`models-store.json`、`decisions-models.json`、`video-models.json`、`pine-settings.json` 里的模型选择和 TinyFish key；默认勾选，待确认）。其余一律从空白开始：没有对话、项目、记忆、技能、MCP、微信、自动化。
- 编辑对话框与添加相同，但没有复制选项。
- 删除：不能删除当前用户和原始用户。确认对话框写明会移除什么；数据目录整体移到废纸篓 / 回收站（`shell.trashItem`），不做永久删除；删除前检查是否是 `lastUserId` 并回落。
- 开关「打开 Pine 时询问是谁在使用」（仅多用户时显示）。
- 每个非当前用户若有已启用的自动化或微信绑定，在行内显示一行灰字：「不在使用时，ta 的 3 个自动化不会运行」。

## 8. 后台功能

同一时刻只有活动用户的 `PineCore` 运行：

- 自动化：其他用户的自动化不运行。他下次打开 Pine 时由现有的“错过的运行”策略处理（`missed: run-once | skip`），不需要新逻辑。
- 微信遥控、浏览器访问、Remote Control：只有活动用户的在线；其他用户发来的微信消息在他回来后由微信侧重新投递（现有重连逻辑），离线期间微信里看到的是 Pine 不在线。
- 快速输入框、Live Context、托盘：属于活动用户。
- 「切换用户」与「退出」共用一套阻塞检查和确认文案（运行中的会话 / 遥控会被停止）。

不做“所有用户的后台核心同时跑”：那需要多个 agent 进程、多个微信长连接和端口，以及一个没有窗口归属的通知模型；收益是家庭场景里少见的“别人用电脑时我的定时任务照跑”。可作为后续单独功能。

## 9. 隐私预期

- 默认无密码。界面文案明确：多用户是为了让每个人的东西不混在一起，不是锁。
- 最重要的隔离是**记忆**和**会话**：全局记忆里是关于某个人的事实（关系、作息、敏感文档），新用户必须从空白开始，绝不复制。
- 可选 PIN 作为后续：只能防误入，不能防有意读取（文件和 `safeStorage` 对同一系统账户可读）。真正需要隔离时应建议各自使用系统账户，这句话写进帮助提示。

## 10. 风险

1. **共享 Chromium 存储导致串数据**：localStorage 回退与 `adoptWebStoragePreferences`（§5）。需要测试：新用户首次启动后 `ui-preferences.json` 为空。
2. **启动顺序改动**：`PreferenceStore`、`exposeRequestsOverIpc`、托盘、快速输入框目前假定 core 在第一个窗口之前就绪；选择界面阶段 `core` 为 `undefined` 的分支要逐一覆盖（`openPine()` 现在 `if (!core) return`）。
3. **两个 Pine 进程同时运行**：目前没有 `requestSingleInstanceLock`；若有第二实例且选了另一个用户，两个进程共享 Chromium 目录。实施时确认现有第二实例处理方式，必要时加单实例锁。
4. **删除用户**：只移到废纸篓；废纸篓不可用（如网络盘）时拒绝删除而不是 `rm -rf`。
5. **复制凭据**：`auth.json` 是 pi 的明文格式（权限 600），复制后两份独立；改一边不影响另一边，文案说明。`safeStorage` 加密的文件可直接复制（同一系统密钥）。
6. **Windows 沙箱**：低权限账户与 ACL 是按项目文件夹授予的，与 Pine 用户无关；不同 Pine 用户的项目指向同一文件夹时 ACL 共用，可接受。
7. **磁盘与诊断**：日志共享，诊断记录加 `userId`，不写名字。
8. **headless server** 不受影响（自带 `--data-dir`）。
9. **文档**：`PINE_UI.md`、`aldinelabs/docs`（中英）需要新页面或段落。

## 11. 实施计划（确认后）

原子提交，大致顺序：

1. `feat(desktop): add the user registry` — `users.json` 读写、校验、原子写、复制模型连接、移到废纸篓；纯 main 模块 + 单测（含损坏文件、原始用户不可删、降级兼容）。
2. `feat(desktop): start Pine as the chosen user` — 启动顺序重排、`--pine-user`、按用户的 `PreferenceStore` 与数据根、localStorage 回退与 adopt 的限制、切换 = 确认后重启；单测覆盖“单用户路径与今天完全相同”。
3. `feat(desktop): ask who's using Pine at launch` — `#/who` 路由、窄 preload API、磁贴与键盘、记住选择。
4. `feat(desktop): manage users in settings` — 设置分区、添加 / 编辑 / 删除对话框、后台任务提示。
5. `feat(desktop): switch users from the sidebar and menus` — 侧边栏底部头像菜单、应用菜单、托盘。
6. 每个 UI 提交同步 9 种语言与 `PINE_UI.md`。

验证：隔离的开发实例（`--user-data-dir=<scratch>`），先造一个 0.22.0 布局的数据目录，确认升级后原始用户一切不变、新增用户为空、删除 `users.json` 后回到原状；截图选择界面和设置分区（浅色 / 深色）。

## 12. 待确认的问题

1. 新建用户时「复制我的模型连接」默认勾选还是不勾选？（建议勾选：家庭通常共用一个付费 key。）
2. 原始用户不能删除，可以接受吗？（换来零迁移和可降级。）
3. 非活动用户的自动化和微信在别人使用时暂停，可以接受吗？
4. 选择界面里允许直接「添加用户」，还是只能在设置里加？
5. 头像只用 emoji + 颜色（不支持上传照片），可以吗？
