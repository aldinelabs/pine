# Pine 助理（Orchestrator）对话：调研与设计提案

状态：草案，未实现。调研日期 2026-11-24。本文不改变任何现有行为。

证据标记：

- **[确认]**：一手来源（官方页面、帮助中心）或本仓库代码。
- **[二手]**：媒体报道或社区帖子，多家一致的算二手，不算确认。
- **[推测]**：作者的推断。

---

## 0. 结论先行

- **做一个全局、唯一、常驻的“Pine 助理”对话**：不属于任何项目，微信是它的第一个入口，桌面端是第二个入口，两边是同一条线程。不要做成“微信专用”，否则以后桌面、Pine Remote、其他 IM 都要再做一遍。
- **它只派活和汇报，从不亲自干活**。这一点靠机制保证，不能只写在 prompt 里：
  1. 会话种类固定为 `orchestrator`，工具清单在创建时定死，里面没有任何文件、Shell、网页、Computer Use、媒体或 MCP 工具；
  2. 工具调用钩子里再做一层白名单拒绝（复用 side chat 的“列出但拒绝”模式）；
  3. 工作目录是一个空的专用目录，不共享任何用户文件夹。
- **新增一组“管理工具”**，大多是现有 `ui_session_*`、`ui_project_*`、`automation_*`、`memory_*` 工具的跨项目版本，另加三类新能力：派活并自动回报（`dispatch`）、全局看板（`overview`）、提醒和盯梢（`watch`）。
- **点命令保留，作为确定性的快捷方式**：`.y NN`、`.stop`、`.pause` 等不经过模型，延迟低、不可注入。普通文字的默认去向从“当前会话”改为“助理”，`.u` 进入“直连”某个工作会话，`.home` 回到助理。
- **审批永远不由模型代答**：助理可以转述审批卡片、解释风险，但批准只能通过确定性路径完成，也就是 `.y NN`、桌面按钮，或者由桥接器而不是模型识别的“批准 12”。这样 Pine 就不会出现“被注入的模型替用户点了批准”。
- **派出会话的结果由助理转述**：派出的会话结束一轮就唤醒助理，由它在用户派活的地方（微信或桌面）用自己的话告诉用户，用户始终像在和同一个人连贯地聊天；审批仍是确定性的模板卡片。
- **分 4 个阶段落地**：P0 原型、P1 微信、P2 桌面入口、P3 管理面扩展。最大风险是三条：长线程的成本和漂移、经会话内容进来的提示注入、微信回复额度。

---

## 1. 对标产品调研

### 1.1 Grok Bot（xAI）

“Grok Bot”指 xAI 在 2026-08-11 发布的 **Grok Bot**（早期 beta）。[确认] [x.ai/news/introducing-grok-bot](https://x.ai/news/introducing-grok-bot)

不是下面两个：

- 2025 年 Telegram 里只能问答的 @GrokAI 集成 [二手]（[TechCrunch](https://techcrunch.com/2025/05/28/xai-to-invest-300m-in-telegram-integrate-grok-into-app)）；
- Grok Build 里的 Automations 功能。

| 维度        | 内容                                                                                                                    | 证据                                                                                                                                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 交互形态    | 在线程里像给同事发消息一样派活；手机和桌面接着用同一条线程；可以拉进群聊，多个 Bot 互相协调                             | [确认] x.ai                                                                                                                                                                                                            |
| 平台        | beta 在桌面和 iOS 上可用                                                                                                | [确认] x.ai；Windows、Linux、Android 的说法 [二手] [VentureBeat](https://venturebeat.com/orchestration/spacexais-grok-bot-turns-agents-into-persistent-digital-coworkers-that-can-operate-your-apps-for-120-per-month) |
| 常驻 / 后台 | 每个 Bot 有自己的云端电脑，7×24 工作                                                                                    | [确认] x.ai；定时任务和邮件触发 [二手] [MindStudio](https://www.mindstudio.ai/blog/grokbot-xai-agent-app)                                                                                                              |
| 能力边界    | 能登录并操作没有 API 的网站和应用；看用户演示一遍就能学会流程，存成 routine。用户不能选择底层模型，长期运行受用量池限制 | 前两项 [确认] x.ai；后两项 [二手] VentureBeat                                                                                                                                                                          |
| 记忆        | 记得过去的对话，学习用户的偏好                                                                                          | [确认] x.ai                                                                                                                                                                                                            |
| 通知 / 审批 | 只在需要批准或任务完成时回来找你。具体哪些操作需要审批没有公开                                                          | [确认] x.ai；“自己学会何时请示”的说法 [推测]                                                                                                                                                                           |

### 1.2 dots（OpenAI）

“Dots”指 OpenAI 在 2026-09-29 DevDay 发布的 **dots**（单个称为 a dot），2026-11-03 有更新。[确认] [openai.com/index/introducing-dots](https://openai.com/index/introducing-dots/)

不是下面两个，二者都没有派活能力 [推测]：

- App Store 上同名的第三方应用 “Dot – AI Personal Assistant”；
- New Computer 做的陪伴式日记 AI “Dot”。

| 维度        | 内容                                                                                                                                                                             | 证据                                                                                                                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 交互形态    | 常驻智能体，入口有 ChatGPT 桌面端、网页和移动端，Slack、Teams，以及语音通话                                                                                                      | [确认] OpenAI；[TechCrunch](https://techcrunch.com/2026/09/29/openai-launches-dots-its-bubbly-agentic-avatar/)                                                                                                |
| 短信入口    | 2026-10-28 起美国 Pro 用户可以用 iMessage / RCS 给 dot 发短信，支持文字、图片和语音，只能一对一。可以设成“只有急事才发短信，日常进展留在 App 里”                                 | [二手] [Digital Trends](https://www.digitaltrends.com/computing/openai-now-lets-you-text-your-chatgpt-dot-agent-to-get-things-done/)。官方页面截至访问时写的是 Slack/Teams 消息功能 “coming soon”             |
| 常驻 / 后台 | 自有云端电脑，7×24 推进目标；可以通过插件连接 4 000 多个应用                                                                                                                     | [确认] OpenAI                                                                                                                                                                                                 |
| 记忆        | 继承 ChatGPT 的记忆，之后自己记笔记（也会从连接的应用里记）。dot 自己的笔记只有删除这个 dot 才能清除                                                                             | [确认] [帮助中心](https://help.openai.com/en/articles/20001530-getting-started-with-your-dot)                                                                                                                 |
| 审批        | 内置规则决定何时自主、何时请示。Custom Rules 可以把具体操作设为允许、需审批或禁止。可能影响账户的操作先过一道 auto-review。短信里遇到要审批的操作，会发一个链接让用户回 App 确认 | 前三项 [确认] OpenAI；短信链接 [二手] Digital Trends；“审批过于频繁”的抱怨 [二手] [社区帖](https://community.openai.com/t/dot-repeated-approvals-and-unexplained-403s-make-authorized-tasks-unusable/1412784) |
| 隐私        | 短信经第三方中转，不是端到端加密                                                                                                                                                 | [二手] [techstrong.ai](https://techstrong.ai/agentic-ai/openai-rolls-out-sms-free-messaging-for-dot-agents-raising-new-privacy-questions/)                                                                    |

### 1.3 对 Pine 的启发

1. **共同形态是“一个常驻的人格 + 一条跨设备的线程 + 后台执行 + 只在需要时打扰用户”**，而不是命令行。Pine 的点命令适合熟练用户和紧急情况，日常交互应该是自然语言。
2. **两家都在云端执行，Pine 在用户自己的电脑上执行**。这是隐私和成本上的优势，也带来离线问题：电脑睡眠时消息收不到（见 `docs/wechat-remote-plan.md` 第 1 节）。助理必须如实说明，不能假装在跑。[推测]
3. **审批要分级，而且不能太频繁**。dots 的三档规则（允许 / 需审批 / 禁止）加上 auto-review，与 Pine 现有的审批模式和 AI 审查员基本对应。dots 社区的抱怨说明，审批卡片太多会让远程入口没法用。
4. **IM 入口只放摘要，敏感确认回到可信界面**。dots 的“发链接回 App 确认”与 Pine 微信“高风险只能在本机批准”是同一个思路，应该保留。
5. **记忆跨入口共享，并且可以查看和清除**。dots 自己的笔记删不掉曾被诟病；Pine 应该让助理的笔记在设置里看得见、删得掉（沿用现有记忆面板）。

---

## 2. Pine 现有可复用的基础设施

### 2.1 微信远程

完整说明见 `docs/architecture/wechat-remote.md`。

- **通道**：ClawBot / iLink 长轮询（`packages/wechat-ilink`）。桥接器 `main/wechat/bridge.ts` 以虚拟客户端 `WECHAT_CLIENT_ID = -2` 操作 `core.runtimes`，桌面端和无头服务端都能用。
- **路由**：普通文字发给“当前会话”，空闲时作为下一条消息，运行中作为 steering，过期时暂存待确认。`.new`、`.use` 切换会话；`.projects` 选择新会话的项目。
- **命令**：约 40 个点命令，唯一来源是 `main/wechat/commandSpec.ts`，由它生成解析器和 `.help`。命令分四类：
  - R：只读，如 `.status`、`.sessions`、`.search`、`.last`、`.history`、`.pending`、`.autos`、`.runs`、`.usage`、`.todo`、`.tasks`；
  - M−：只降低活动或风险，如 `.stop`、`.pause`、`.reject`、`.kill`、`.unqueue`；
  - M：在现有限制内修改，如 `.new`、`.use`、`.queue`、`.model`、`.effort`、`.mode`、`.compact`、`.approve`、`.answer`、`.rename`；
  - D：不可逆或发出文件，如 `.delete`、`.file`、`.auto N run`。
- **明确不提供**：项目增删改、设置修改、自动化编辑、窗口操作。
- **审批**：卡片编号 11–99，绑定 `requestId` 和 `actionDigest`。以下几类只显示、不能在微信里批准：只读会话；高风险的 `privileged-execution` 和 `destructive-pattern`（除非本机开关打开）；自动化的创建、修改和开启。
- **上限**：微信会话的模式不能超过“Highest approval mode”，`approvalModeWithin` 在每次 `prompt` 前断言。
- **推送**：回复额度 `BUDGET = 10` / `USABLE = 8`，按 P0–P4 优先级发送。发不出去的进入持久化 `outQueue`，在用户下一条消息时以 `T-DIGEST` 补发。跟踪的会话最多 20 个。
- **安全不变量**：13 条，每条都有测试（`main/wechat/__tests__/security.test.ts`），助理必须全部继承。

### 2.2 会话、子会话和后台任务

- `agent/sessionTools.ts`：
  - `ui_session_new`：`relation: child | sibling`。`projectId` 只对顶层 sibling 有效；子会话只能在本项目、只有一层深；`approvalMode` 不能超过调用方的模式；在 Let Me Review 下启动会话需要审批。
  - **child 每结束一轮就向父会话报告**。这正是“派活后自动回报”的机制，但目前只能在同一项目里用。
  - 读写其他会话：`ui_session_read`、`ui_session_send`、`ui_session_relatives`（亲属会话直接执行；其他会话要传 `projectId` 并先经审核）、`ui_session_search`（可跨项目）、`ui_session_tree`、`ui_session_stop`、`ui_session_rename`、`ui_session_delete`、`ui_session_organize`、`ui_session_teleport`。
- `main/core/requests/sessions.ts` 的 `startBackgroundSession` / `answerSessionOperation(op: "start")`：在后台起会话，不抢焦点，带 `approvalModeWithin` 钳制；微信 `.new` 走的就是它。
- 后台进程：`@pine/pi-background-tasks`（`bg_run` / `bg_status` / `bg_logs` / `bg_kill`）。这是执行工具，助理不需要。
- 项目：`ui_project_list` / `ui_project_create` / `ui_project_update` / `ui_project_delete`，以及 `ui_list_models`。

### 2.3 审批流

- 4 档模式：Let Me Review、Auto Approve（AI 审查员，必要时交给用户）、Autonomous Work（AI 审查员不交给用户）、YOLO。规则写在 system prompt 的固定段落里，当前模式通过对话中的 `approvalModeNotice` 告诉模型，所以切换模式不改变前缀（`agent/system-prompt.ts`）。
- `approval-request` 事件经 `PineCore.routeAgentEvent` 分发给所有附着的客户端，先到的有效回应生效。微信、桌面、Pine Remote 共用这一套。

### 2.4 自动化与记忆

- 自动化：
  - 工具：`automation_list` / `automation_get` / `automation_check` / `automation_save` / `automation_set_enabled` / `automation_run_now` / `automation_delete` / `automation_report`。除 `automation_report`（每次运行结束时调用）外，这 7 个工具都要先 `activate_automation_authoring` 才动态加入（`agent/automation/tools.ts`）；自动化运行固定为 Autonomous Work，存储在 `<projectsRoot>/<id>/automations/<aid>/`。
  - 服务：`main/automation/service.ts`。
  - 远程入口创建、修改、开启自动化只能在本机批准。
- 记忆：
  - 工具：`memory_read` / `memory_save` / `memory_remove`，分 project 和 global 两个范围。
  - 系统 prompt 里的 `MEMORY_SYSTEM_PROMPT` 是固定文本；笔记索引作为 `memory` 上下文通知注入，预算 6 000 字符（`agent/memory/prompt.ts`）。

### 2.5 界面操作与按需激活的工具

- `activate_*`：`activate_pine_ops`、`activate_computer_use`、`activate_media_generation`、`activate_skill_authoring`、`activate_automation_authoring`、`activate_mcp_authoring`。它们是“会话变换器”（session mutators）。除 `activate_pine_ops` 外，激活后才开放对应的一组工具。
- `activate_pine_ops` 目前只按需返回 `pine-ops/PINE_UI.md`（约 1 450 行），用来解释界面、指出控件位置，不启用任何工具。现有的 `ui_*` 工具都是常驻工具，不依赖它。
- `ui_workbench_*`、`ui_present_file`、`ui_submit_artifact` 是工作台和产物相关的工具。

### 2.6 工具启用 / 禁用

- 设置 › 智能体 › 工具 的 11 个分组开关：`shell`、`web`、`computerUse`、`media`、`workbench`、`liveContext`、`sessions`、`projects`、`skills`、`automations`、`mcp`（`shared/toolGroups.ts`），存在 `pine-settings.json` 的 `toolGroups` 里，映射在 `agent/runtime/tool-groups.ts` 的 `TOOL_GROUP_TOOL_NAMES`。
- `runtime.ts` 根据激活状态和分组开关计算 `setActiveToolsByName`。有 `canonicalOrder` 时按固定顺序重建工具列表，避免顺序变化破坏缓存。
- **side chat 的先例**（`agent/sideChat.ts`）：
  - 为了不破坏父会话的前缀缓存，会改动内容的工具**仍然列出，但调用时拒绝**；
  - 允许的集合是 `SIDE_CHAT_READ_ONLY_TOOL_NAMES`；
  - 进入 side chat 的说明以一条隐藏的 `<system-reminder>` 消息追加在对话末尾。

  助理的强制方式可以直接借鉴。

### 2.7 System prompt 组装与前缀缓存

- 结构是 `PINE_SYSTEM_PROMPT`（固定）→ `systemPromptForPlatform`（按平台替换）→ 固定的权限模式段落 → `systemPromptWithUserProfile`（用户资料）→ 工作风格段落（每种风格一段固定文本）→ 记忆、技能等固定段落。
- 会变化的内容通过追加的对话消息进入，不改 system prompt：审批模式提示（`approvalModeNotice`）；context notice，键包括 `workspace`、`user_profile`、`disabled_tools`、`wechat`、`skills`、`memory`、`network_region`、`approximate_location`，只在变化时追加（`runtime/context-notices.ts`）；只追加的 `<live_context>` 块（实时上下文）。固定章节（工作风格、`pine_memory` 等）要么整段有、要么整段没有，不做编辑。
- **助理必须遵守同一条规则**：它的 system prompt 和工具清单在会话生命周期内是常量；全局看板、事件、项目列表这类动态状态只能作为追加消息或工具结果进入对话。

### 2.8 已有的“非项目 / 非窗口”先例

- “No Project”临时工作区：微信 `defaultProjectId: null` 时新会话落在这里。它本身也是一个项目（固定 id `TEMPORARY_WORKSPACE_PROJECT_ID`），所以目前**没有**独立于项目的全局会话。
- 自动化会话：不属于任何窗口，自己观察事件。
- 快速提问（Quick composer）：全局快捷键，可以在后台发送，完成后发系统通知。它是“全局入口”的现成 UI 先例，但提交时必须带 `projectId`。
- 虚拟客户端：`WEB_CLIENT_ID`、`WECHAT_CLIENT_ID`。

---

## 3. 设计提案

### 3.1 定位：全局固定对话，微信优先

| 方案                     | 优点                                                                               | 缺点                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 微信专用                 | 范围小，安全模型直接沿用微信桥接器                                                 | 桌面看不到；以后接 Pine Remote、飞书或别的 IM 要重做；用户在两处看到的上下文不一致 |
| **全局固定对话（推荐）** | 一条线程跨入口，与 Grok Bot、dots 的形态一致；桌面上可以审阅它派过的活、改它的记忆 | 要新增会话种类、存储位置和桌面入口                                                 |

推荐：

- **每个 Pine 用户（multi-user 里的每个用户）一个助理**；
- 存在应用数据目录的 `assistant/` 下，与 `projects/<id>/` 并列，不属于任何项目，也不写入用户文件夹（符合 `docs/project-system.md`）；
- 第一个入口是微信，第二个是桌面，同一条线程；
- 消息标注来源（微信 / 桌面），桌面上能看到微信里发生的一切。

### 3.2 人格与说话方式

- **角色**：用户的“前台和调度员”。听懂意图，找到对的项目和会话，派活、盯进度、汇报结果，帮用户做决定，但不替用户做决定。
- **说话方式**：
  - 短，先给结论再给细节；在微信里默认 3–6 行，不用表格（ClawBot 渲染有限）；
  - 每条汇报都能单独读懂，带上会话名和项目名；
  - 说状态时只引用工具查到的事实，不确定就说不确定；
  - 绝不声称自己做了实际工作，用“已派给『修登录页』会话”这种说法；
  - 沿用用户资料里的沟通风格和技术背景（复用 `systemPromptWithUserProfile`）。
- **主动但克制**：只在完成、失败、需要审批或卡住时打扰用户（与 Grok Bot、dots 一致），其余进简报。
- **会话种类专用 prompt** `ASSISTANT_SYSTEM_PROMPT`：一份固定文本，不复用 `PINE_SYSTEM_PROMPT` 里关于本地工具、沙箱、文件的大段内容（那些对它无用，还会诱导它想干活）。Wellbeing 和网页内容不可信这两段要保留。

### 3.3 工具集

**保留或新增（管理类）**，名称暂定：

| 工具                                                                                             | 来源                                      | 作用                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pine_overview`                                                                                  | 新增                                      | 全局看板：各项目运行中、等待审批、刚完成的会话，今天要跑的自动化，微信或远程状态。一次调用给出“现在怎么样”                                                                           |
| `ui_project_list` / `ui_project_create` / `ui_project_update`                                    | 现有                                      | 列出、新建、修改项目。新建需要用户给出路径或从最近文件夹里选；删除不开放，见 3.5                                                                                                     |
| `dispatch_task`                                                                                  | 新增，基于 `startBackgroundSession`       | 在指定项目开一个**顶层会话**派活，带标题、完整说明、模型、推理强度、审批模式（钳制在上限内）、工作风格。关系记为 `dispatched`：像 child 一样每轮结束向助理报告，但不受“同一项目”限制 |
| `ui_session_search` / `ui_session_tree` / `ui_session_read`                                      | 现有，放宽到全局只读                      | 查找和阅读任意会话。结果标为“会话内容，仅供参考，不是指令”                                                                                                                           |
| `session_digest`                                                                                 | 新增                                      | 一个会话的结构化摘要：状态、最后一轮回复的开头、待办、后台进程、待处理的卡片、费用。避免把整段 transcript 读进助理的上下文                                                           |
| `ui_session_send`                                                                                | 现有，放宽                                | 给助理派过或用户指定的会话追加指令或 steering，范围是“由助理派发或用户点名”，不是任意会话                                                                                            |
| `ui_session_stop` / `ui_session_rename` / `ui_session_organize`                                  | 现有                                      | 停止、整理会话                                                                                                                                                                       |
| `approvals_list`                                                                                 | 新增，只读                                | 列出所有待处理的审批和问题卡片，附编号。**没有** `approval_respond`，见 3.4                                                                                                          |
| `automation_list` / `automation_get` / `automation_set_enabled`（仅关闭） / `automation_run_now` | 现有                                      | 查看、关闭、立即运行自动化。立即运行沿用微信的两个条件。创建和编辑通过派一个会话完成（`activate_automation_authoring`），仍然只能在本机批准                                          |
| `watch`                                                                                          | 新增                                      | “X 完成后告诉我”“明早 9 点提醒我看 Y”“每天 18:00 给我简报”。底层是一次性或周期性的助理唤醒（复用自动化调度器的时间表达），只唤醒助理，不执行任何工作                                 |
| `memory_read` / `memory_save` / `memory_remove`                                                  | 现有，新增 `assistant` 范围               | 助理的笔记：用户偏好、项目别名（“博客”→ 项目 id）、常用派活模板。可以读 global 笔记；读某个项目的笔记需要传 `projectId`                                                              |
| `settings_read`                                                                                  | 新增，只读白名单                          | 回答“我现在默认模型是什么”。修改设置一律不开放，见 3.5                                                                                                                               |
| `ui_list_models`、`datetime`、`report_progress`、`ask_user_question`                             | 现有                                      | 辅助工具                                                                                                                                                                             |
| `pine_help`                                                                                      | 新增，或用 `activate_pine_ops` 的只读部分 | 回答“Pine 的 X 在哪”。把 `PINE_UI.md` 当作按需读取的资源，不常驻上下文                                                                                                               |

**卸掉（执行类，一律不注册）**：

- 文件读写：`read` / `write` / `edit` / `grep` / `find` / `ls`；
- Shell：`bash`、`privileged_bash`、PowerShell 变体、`bg_*`；
- 网页：`web_search`、`web_fetch`、TinyFish；
- 按需激活的工具：Computer Use、媒体生成，以及 `activate_*` 中除只读帮助以外的全部；
- 所有 MCP 服务器工具；
- 技能调用（第一版）；
- 工作台和产物：`ui_workbench_*`、`ui_present_file`、`ui_submit_artifact`；
- `ui_teleport`。

> 关于网页搜索：“今天天气”“某某是什么”这类问题，助理不能自己查，而是派给 No Project 里的一个轻量会话（可以指定便宜的模型），结果回来后转述。这样多一跳延迟，但边界清楚。如果实测后体验太差，可以单独评估是否给助理开放只读的 `web_search`；本提案默认不开。

### 3.4 “永不亲自干活”的机制保证

分四层，任何一层失效，其他层仍然成立：

1. **注册层**：`orchestrator` 会话种类有自己的工具注册表，执行类工具根本不构造，因此不进入工具定义，模型看不到。工具清单在会话创建时固定；设置 › 智能体 › 工具 的开关和 MCP 配置**不作用于**助理，否则会改变工具定义、破坏缓存，也会意外放进执行工具。
2. **调用层**：工具调用钩子里有一个白名单 `ASSISTANT_TOOL_NAMES`，名单之外的调用一律拒绝。这和 side chat 的 `isSideChatReadOnlyTool` 是同一套写法，防的是以后有人往注册表里加了工具却忘了。
3. **环境层**：助理的 cwd 是 `assistant/workspace`，一个空目录，不共享任何文件夹，沙箱也不放行其他路径。
4. **测试层**：
   - 一个快照测试断言助理的工具清单与名单完全相等；
   - 一个 `verify:pi` 风格的冒烟测试：用 mock provider 真跑一轮，断言请求里的工具定义没有执行类工具；
   - 一个安全测试：模型试图调用 `bash` 时被拒绝。

另外两条规则：

- **会话变换器**（`activate_*`）在助理里不可用。
- 助理派出去的会话就是普通会话，在各自项目里按各自的审批模式干活；助理本身不继承它们的工具。

### 3.5 审批与安全

- **上限**：助理派出的会话，审批模式不超过“助理上限”。微信入口沿用现有的“Highest approval mode”；桌面入口以用户本机设置为准。上限只能在本机修改。
- **审批不由模型代答**。助理的回复可以附上卡片编号，比如“『修登录页』想执行 `rm -rf build/`，回复 `.y 12` 批准”。批准路径只有三条：
  - 点命令 `.y NN`；
  - 桌面按钮；
  - 桥接器对极少数自然语言的确定性识别：整条消息匹配“批准/同意 + 编号”的固定正则，不经模型。

  这样，即使助理被会话内容里的注入文本操纵，也无法替用户批准。`approvalCardPolicy` 的三类“只能在本机批准”保持不变。

- **助理自身的敏感动作**需要确定性确认卡片：`dispatch_task` 用到高于默认的模式、`automation_run_now`、`ui_project_create`、`ui_session_stop all`。这些复用现有的 `approval-request` 和编号机制，由用户 `.y NN`。一次普通的 `dispatch_task` 不需要确认，否则就失去了助理的意义；Let Me Review 下除外，与现有 `ui_session_new` 一致。
- **不开放给助理的操作**：
  - 删除项目、删除非助理派出的会话；
  - 修改 Pine 设置、微信设置，恢复暂停；
  - 凭据、提供商登录；
  - 远程配对、浏览器访问。

  这些都与微信安全不变量 6 一致。用户提出时，助理回答“请在电脑上的 设置 › … 操作”，或者像 `.auto N on` 一样在电脑上发起一个本机审批请求。

- **提示注入**：
  - 助理读到的会话内容、搜索片段和派活结果都标为不可信数据；
  - `ui_session_read` 返回的内容如果来自读过外部内容的会话，带 `T-EXTERNAL` 标记，沿用微信的规则；
  - 助理可以基于这些内容向用户**建议**下一步，但不会自动派新活，除非用户在本轮明确要求，或者是一条已经存在的 `watch` 规则。
- **费用**：
  - 新增“助理每日派活数 / 每日费用提醒”，只提醒、不硬拦，默认关闭，Pine 现有原则是不限制用户；
  - `pine_overview` 里显示今天的累计费用；
  - 助理自己默认用中档模型，可以单独设置。

### 3.6 与现有命令系统的关系

- **全部保留**，`commandSpec.ts` 不删命令。点命令是确定性的快捷方式：不经过模型、不花 token、不会被注入，而且在模型或提供商不可用时仍然能用（`.stop`、`.pause`、`.y`）。
- **普通文字的默认去向改为助理**。新增两个命令：
  - `.u N` / `.use` 进入“直连”，之后的普通文字直接发给那个工作会话，与今天的行为相同；
  - `.home` / `.助理` 退出直连，回到助理。

  `.status` 显示当前是“助理”还是“直连：会话名”。

- **兼容开关**：本机设置“微信普通消息发给：助理 / 当前会话”，后者就是今天的行为。升级后默认值待定，见第 5 节。
- **助理理解命令**：用户问“怎么快速批准”，助理会教 `.y NN`；助理自己的回复里也会给出对应的快捷命令，让命令系统成为助理“教”给用户的高级用法。
- 长期看，`R`（只读）类命令和 `pine_overview`、`session_digest` 共用同一个数据层，避免出现两份“状态”逻辑。

### 3.7 跨项目上下文与记忆

- 助理不预载任何项目内容。需要时它会：
  1. 用 `pine_overview` 或 `ui_project_list` 定位项目；
  2. 用 `session_digest` 看状态；
  3. 只有必要时才用 `ui_session_read` 读原文。
- **项目解析**：用户说“博客那边”，助理先查 `assistant` 记忆里的别名，再按项目名做模糊匹配。有歧义时问一句并给出候选，不猜。第一次确认后存为别名笔记。
- **记忆范围**：
  - `assistant`：助理自己的笔记；
  - `global`：所有会话共享，助理可以读写；
  - 项目笔记：助理只读，需要时按项目读。

  派活时，助理把相关的用户偏好写进派活说明，不依赖子会话去读助理的记忆。

- **长线程**：
  - 一条逻辑线程，物理上按“压缩点”轮换：沿用现有 compaction（`runtime/semantic-compaction.ts`），压缩后的摘要加上记忆，构成新段的开头；
  - 桌面上可以按天回看。
  - 这样前缀缓存在每段内稳定，又不会让线程无限增长。

### 3.8 通知与主动汇报

| 事件                         | 默认行为                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 派出的会话完成、失败或被停止 | **唤醒助理**，由它转述结果：微信派的活回到微信（发不出时改为桌面通知），桌面派的活写在对话里并发桌面通知；会话自己不再推送结果或发完成提示 |
| 派出的会话需要审批或回答问题 | 模板卡片，复用现有卡片和编号                                                                                                               |
| 用户问“怎么样了”             | 唤醒助理，它调用 `pine_overview` 或 `session_digest` 后用自然语言回答                                                                      |
| `watch` 规则触发             | 唤醒助理一轮，写一段汇总；周期简报（“每天 18:00”）同理                                                                                     |
| 微信回复额度用尽或超出时效   | 进入 `outQueue`，下一条入站消息时补发 `T-DIGEST`；同时按用户设置发桌面通知                                                                 |

- **为什么唤醒助理转述**：和子会话向父会话汇报一样，结果先回到助理，再由助理转述，用户不会同时收到工作会话的原话和助理的话。代价是每次完成多一轮助理调用、多占一次微信回复额度，由费用提醒和回复额度兜底。
- **事件进入助理线程的方式**：作为追加的上下文通知（“『修登录页』已完成：……”），不改 system prompt，不破坏缓存。完成类通知会唤醒助理；审批类通知等下次对话时看到。
- **微信的物理限制**：只能在用户最近一条消息留下的窗口内主动发消息（社区实测约 10 条、有时效）。所以“明早 9 点提醒我”在微信里不一定送得到，届时改为发桌面通知，并在下一次对话开头补上。设置页需要写明这一点。

### 3.9 桌面端 UI 入口

- **侧栏顶部固定项“Assistant”**（中文“助理”）：在项目列表上方，点开是一个普通的会话标签，但属于“助理”这个特殊位置，不属于任何项目。项目列表窗口和每个项目窗口都能打开它，同一时间只在一个窗口里打开，沿用“项目已在别的窗口打开”的规则。
- **会话头部**：显示“Assistant”和助理上限模式，没有工作台（没有产物和文件）。每条消息标注来源（WeChat / Desktop）。助理派活的回复里，会话名是可点击的链接，打开对应项目的那个会话。
- **派出的会话**：侧栏标“From Assistant”，复用现有“From WeChat”标签的实现。会话顶部有“由助理派发”的返回链接。
- **快速提问**：快捷撰写框增加一个目标选项“发给助理”。默认仍然是新对话，避免改变现有行为。
- **托盘**：显示“助理：N 个任务运行中、M 个待审批”。
- **设置 › 助理**：模型、上限模式、微信普通消息去向、主动汇报策略（仅急事 / 完成就告诉我 / 只在简报里）、简报时间、费用提醒，以及“查看和删除助理的笔记”，链接到记忆面板。
- 落地时需要同步：`PINE_UI.md` 的新章节和快捷键、`aldinelabs/docs` 中英文页面、`docs/architecture/wechat-remote.md` 的路由表。

### 3.10 代码落点（预估）

| 位置                                              | 内容                                                                                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/agent/assistant/`               | `ASSISTANT_SYSTEM_PROMPT`、工具注册表与白名单、`pine_overview` / `session_digest` / `dispatch_task` / `watch` 的工具定义         |
| `apps/desktop/src/main/assistant/`                | `AssistantService`：持有线程、订阅派出会话的事件、唤醒策略、`watch` 调度；作为第三个虚拟客户端（或复用自动化的“无窗口会话”路径） |
| `apps/desktop/src/main/core/requests/sessions.ts` | `relation: "dispatched"`：跨项目、每轮回报给助理                                                                                 |
| `apps/desktop/src/main/wechat/`                   | 路由切换（助理 / 直连）、`.home`、“批准 + 编号”的确定性识别、助理回复走现有 outbound 和额度逻辑                                  |
| `apps/desktop/src/shared/assistant.ts`            | 类型、IPC 通道和设置结构                                                                                                         |
| 渲染进程                                          | 侧栏入口、会话头部、设置页；只通过 preload IPC 访问主进程                                                                        |

---

## 4. 分阶段落地

| 阶段                | 范围                                                                                                                                                                                       | 验收                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0 原型**（内部） | `orchestrator` 会话种类、固定 prompt 和工具白名单（四层保证里的 1、2、4）、`pine_overview`、`dispatch_task`（顶层会话 + 回报）、`session_digest`。不做 UI，在 dev 实例里用一个隐藏入口验证 | `verify:pi` 风格的测试通过；人工跑 20 个典型指令（建项目、派活、查进度、停止、问审批），观察误派率和延迟                                     |
| **P1 微信**         | 普通文字发给助理；`.u` 直连和 `.home`；审批的确定性识别；模板推送沿用现有逻辑；助理记忆（别名）；兼容开关                                                                                  | 现有 `security.test.ts` 全部通过，新增助理相关的不变量测试；mock iLink e2e：“帮我在博客项目里修一下首页样式” → 派活 → 卡片 → `.y` → 完成推送 |
| **P2 桌面入口**     | 侧栏“Assistant”、来源标注、“From Assistant”标签、设置 › 助理、快速提问目标、托盘状态、`PINE_UI.md` 和 docs 仓库同步                                                                        | 桌面和微信同一线程互通；助理线程压缩后可回看                                                                                                 |
| **P3 管理面扩展**   | `watch`（提醒、盯梢、每日简报）、自动化查看和运行、项目新建、设置只读查询、费用提醒、本机审批转发（“在电脑上开启自动化 X”）                                                                | 简报准时；微信额度不足时正确降级为桌面通知                                                                                                   |
| P4（可选）          | 其他通道（企业微信、飞书、Telegram）复用同一个助理；语音；助理可调用的“管理类技能”                                                                                                         | —                                                                                                                                            |

---

## 5. 风险与待决问题

**风险**：

1. **成本和延迟**：每条普通消息都要经过一次模型调用，比现在直接转发多一跳。缓解：点命令保留零模型调用；助理用中档模型；固定前缀让缓存命中率高；推送默认用模板。
2. **长线程漂移**：常驻对话越来越长，模型可能引用过时的状态。缓解：状态只从工具读取，prompt 要求“说状态必须先查”；按压缩点轮换。
3. **提示注入经会话内容进入**：工作会话读过网页，它的回复可能带有指令。缓解：审批不由模型代答；不可信标记；助理的敏感动作需要确定性确认；不自动派活。
4. **误路由**：派到了错误的项目。缓解：有歧义就问；每次派活的回复写明“项目 › 会话名”；`.stop` 随时可用。
5. **微信回复额度和时效**：助理更“话多”，会更快用尽额度。缓解：助理回复计入同一套额度和优先级；长回答分页；没有必要时只回一条。
6. **离线**：电脑睡眠时助理也不在。缓解：如实说明；推荐无头服务端或保持唤醒（现有设置）。
7. **行为变化**：老用户习惯了“普通文字发给当前会话”。缓解：兼容开关，升级后首次在微信里说明一次。

**待决问题**（需要产品决定）：

1. 名称：Assistant / 助理，还是 Concierge / 管家，或者别的？
2. 升级后微信普通消息的默认去向：助理（新用户）、当前会话（老用户）？
3. 助理是否开放只读的 `web_search`，用来回答简单的常识问题？
4. 每个用户一个助理，还是允许多个（例如“工作助理”“家里助理”）？本提案只做一个。
5. 助理的默认模型由用户选，还是 Pine 推荐一个中档模型？
