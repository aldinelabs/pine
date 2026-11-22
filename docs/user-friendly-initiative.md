# 用户友好化行动：调研与方案

> 状态：第一阶段（调研、方案、最小原型）。原型提交 `4b1d72ff`。
> 日期：2026-11-22。

目标：凡是第一次接触 Agent 类产品的普通人可能困惑的地方，都放一个统一的教程入口（带问号图标和文字的按钮）。点开后是一份上图下文的分步教程，讲清"是什么、为什么、要注意什么、原理一句话"。长期看，让 Pine 本身成为一本 Agentic AI 的使用教科书。

## 1. 调研

### 1.1 主流智能体产品现状（2026 年 11 月）

| 产品                       | 现状要点                                                                                                                                                                       | 和本方案相关的设计                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Claude Code                | 权限模式按 Shift+Tab 循环切换（auto → default → acceptEdits → plan）。Plan 模式下只读，计划经批准后才改文件。另有子智能体、Skills、MCP。                                       | 文档明确写着 auto 是研究预览、不保证安全，直接说出风险             |
| Claude Cowork              | 面向非开发者的桌面智能体，2026 年 4 月正式可用。只能访问用户连接的文件夹。权限分 Manual / Auto / Skip 三档，每个连接器工具可单独设置 Always allow / Needs approval / Blocked。 | 帮助页把示例任务按类别列出，权限说明旁边就写明 Auto 可能漏掉的情况 |
| OpenAI Codex app           | 桌面"智能体指挥中心"，按项目组织线程。有 Skills、后台 Automations、可配置沙箱、插件，支持在手机上审批。                                                                        | Learn 区有一页 Best practices                                      |
| ChatGPT agent              | 已下线，由 ChatGPT Work 接替。原有防护：高影响操作前确认、watch mode、接管浏览器、提示注入监测。                                                                               | 官方承认这些防护"只能降低风险"                                     |
| Cursor                     | 2.5 版起子智能体可在后台异步运行；Plan 模式可以交给云端执行，也可以拆给多个子智能体并行。                                                                                      | —                                                                  |
| Google Antigravity / Jules | 智能体产出 Artifacts（计划、diff、截图、录屏），用户在里程碑处审阅、逐行评论，不用盯每一次工具调用。Review Policy 在首次设置时就要求选择。Jules 先出计划，批准后才动手。       | "审阅成果，不盯过程"                                               |
| Manus                      | Wide Research 并行派出大量子智能体；Browser Operator 使用用户本地已登录的浏览器。2026 年新增项目记忆。                                                                         | 第三方评测指出，没有证据表明多智能体优于单个智能体                 |

来源：
[permission-modes](https://code.claude.com/docs/en/permission-modes) ·
[Cowork 入门](https://support.claude.com/en/articles/13345190/getting-started-with-cowork) ·
[Cowork GA 报道（二手）](https://9to5mac.com/2026/04/09/anthropic-scales-up-with-enterprise-features-for-claude-cowork-and-managed-agents/) ·
[Codex app](https://openai.com/index/introducing-the-codex-app/) ·
[Codex for almost everything](https://openai.com/index/codex-for-almost-everything/) ·
[ChatGPT agent 帮助页](https://help.openai.com/en/articles/11752874-chatgpt-agent) ·
[Cursor 2.5](https://cursor.com/changelog/2-5) ·
[Antigravity Artifacts](https://antigravity.google/docs/artifacts) ·
[Artifact review](https://www.antigravity.google/docs/artifact-review) ·
[Jules](https://blog.google/technology/google-labs/jules-now-available/) ·
[Manus Wide Research](https://manus.im/en/blog/introducing-wide-research) ·
[VentureBeat 评 Wide Research](https://venturebeat.com/ai/youve-heard-of-ai-deep-research-tools-now-manus-is-launching-wide-research-that-spins-up-100-agents-to-scour-the-web-for-you)

### 1.2 新手引导是怎么做的

- **Claude Code 的"第一天"指南**：先讲安全规则（每次编辑都要批准，git 可以兜底），再给 5 个由浅入深的起步任务：了解代码库 → 定位代码 → 加一行注释 → 修一个测试 → 提交。最后用 `/init` 写项目说明。[来源](https://support.claude.com/en/articles/14552382-your-first-day-in-claude-code)；[quickstart 的好坏提示对比](https://code.claude.com/docs/en/quickstart)。首启时的点击式引导目前只停留在 issue 提议阶段（[#69924](https://github.com/anthropics/claude-code/issues/69924)）。
- **上下文可视化**：Claude Code 的 `/context` 用彩色网格显示占用，状态栏可以读取剩余百分比（[二手](https://dannywillems.github.io/2026/01/16/claude-code-context-command.html)；[官方博客](https://claude.com/blog/using-claude-code-session-management-and-1m-context)）。
- **Cowork**：输入框里就提示用户描述要做的事；帮助页按文件、研究、文档、数据四类给出示例任务，每档权限都写明风险。
- **Codex**：建议把 Codex 当成需要配置的队友，用 AGENTS.md 沉淀经验：同一个错误出现两次，就让它复盘并写进说明。[best practices](https://developers.openai.com/codex/learn/best-practices)
- **Antigravity**：用 codelab 带新用户上手，首次设置时就要求选择审阅策略。[codelab](https://codelabs.developers.google.com/getting-started-google-antigravity?hl=en)
- **跨产品观察**：UXmatters 认为，嵌入现有工作流的产品比空白聊天框更容易建立"首次会话信任"。用户要依次过四道关：看得懂 → 第一个动作风险低 → 先看到产出 → 能接受、修改或拒绝。[来源](https://www.uxmatters.com/mt/archives/2026/07/first-session-trust-in-ai-products-why-code-editors-onboard-users-better-than-chatbots.php)

结论：目前**没有一家**在产品界面里系统地内置"概念教程"。普遍做法是外部帮助页、示例任务和权限说明文字。Pine 在界面里做成体系的图解教程，是可以拉开差异的地方。

### 1.3 公开的最佳实践与研究

- **Anthropic**：[Claude Code best practices](https://code.claude.com/docs/en/best-practices)（按探索 → 计划 → 编码 → 提交推进；要求智能体给出证据；上下文越满，表现越差）；[Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)（注意力预算有限，会出现 context rot）；[Measuring agent autonomy](https://www.anthropic.com/research/measuring-agent-autonomy)（新用户约 20% 的会话全自动批准，使用约 750 个会话后升到 40% 以上；老手在复杂任务上反而更常打断；数字来自二手报道）；[Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)。
- **OpenAI**：[A practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf)：失败次数超过阈值，或遇到高风险操作时，交给人类处理。
- **Google PAIR Guidebook**：用户的心智模型与产品不匹配会导致误用或弃用；目标是校准信任，而不是最大化信任。[mental models](https://pair.withgoogle.com/chapter/mental-models/)
- **Microsoft HAX 18 条准则**：G1 讲清系统能做什么，G2 讲清能做到多好，G8 便于忽略，G18 变化时通知用户。[链接](https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/)
- **NN/g**：入门引导能省就省；在用户需要的地方给上下文帮助；用宽泛的提示建议。[链接](https://www.nngroup.com/articles/new-ai-users-onboarding/)
- **CMU《Why Johnny Can't Use Agents》**：新手面对智能体有五个障碍：不知道能让它做什么、它没建立信任就动手、协作方式僵化、进度输出看不过来、智能体不知道自己的局限。[arXiv 2509.14528](https://arxiv.org/html/2509.14528v1)
- **自主度分级**：operator / collaborator / consultant / approver / observer 五级。[arXiv 2506.12469](https://arxiv.org/abs/2506.12469)
- **Simon Willison 的 "lethal trifecta"**：私有数据、不可信内容、对外通信三者同时具备，就有数据外泄风险。[链接](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)；[Martin Fowler 网站的延伸文章](https://martinfowler.com/articles/agentic-ai-security.html)

### 1.4 由此得出的设计原则

1. **在需要的地方讲**：教程入口紧挨着控件，不做首启长导览（NN/g，HAX G1/G2）。
2. **风险说具体**：每档权限都写清"会自动做什么、仍会问什么、可能漏掉什么"，不写泛泛的"注意安全"（Cowork，lethal trifecta）。
3. **说明退路**：告诉用户怎么撤回、拒绝、回滚，降低焦虑（HAX 中"出错时"一组）。
4. **用第一个任务教学**：示例任务由浅入深，从只读开始（Claude Code 第一天指南，UXmatters）。
5. **对模型能力保持乐观**：和首页的“Dare the impossible”一致，鼓励用户大胆交出完整任务。审批推荐从“自动审批”开始，“让我过目”留给想亲自把关的任务和付款、对外发送这类无法撤回的操作。放出的权限随时可以收回（Anthropic 自主度研究）。
6. **审阅成果，不盯过程**：教用户在里程碑处检查，并要求智能体给出证据（Antigravity，CMU）。
7. **智能体自己也会讲**：把教程和界面参考交给智能体，用户问"你能做什么"时它能答准（NN/g，CMU）。
8. **不夸大**：文案描述的能力要与实际一致，目标是校准信任（PAIR）。
9. **能关掉、能再找回**：提示不打扰，并能在统一入口重新找到（HAX G8）。

## 2. Pine 功能盘点：新手会困惑的地方

按"困惑程度 × 出错代价 × 触达频率"排序。P0 进入第一、二批。

| #   | 功能                               | 优先级 | 要讲清楚的点                                                                                                                                                                                                                                                           |
| --- | ---------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 工具调用与审批模式 ✅ 原型         | P0     | **是什么**：智能体通过工具动手，审批决定动手前问不问你。**为什么**：在效率和可控之间取舍。**注意**：推荐从"自动审批"开始；YOLO 不设任何防线；付款、对外发送这类无法撤回的事可以临时切到"让我过目"。**原理**：模型写出工具名和参数，Pine 检查后执行，再把结果交回模型。 |
| 2   | 上下文与 token、压缩 ✅ 原型       | P0     | **是什么**：模型每次都重读整个上下文。**为什么**：上下文决定容量、速度和花费。**注意**：压缩会丢细节；一件事一个会话。**原理**：模型没有记忆，缓存能让未变化的前缀更便宜。                                                                                             |
| 3   | 模型与 provider 连接               | P0     | **是什么**：Pine 自己不带模型，需要连接服务商；provider 就是卖模型的公司。**为什么**：不同模型的能力和价格不同。**注意**：API key 等于钱包，别外传；订阅登录和 API key 的区别；"Recommended" 是什么意思。**原理**：Pine 把对话发给服务商，按 token 计费。              |
| 4   | 思考 / 推理强度                    | P0     | **是什么**：回答前先"想"多久。**为什么**：难题想得越久越准。**注意**：越高越慢越贵；简单问题用低档；"Thinking…" 面板里的内容是摘要，不等于真实的推理过程。**原理**：模型先生成推理 token，再给出答案。                                                                 |
| 5   | 中止与插话（Stop / Steer）         | P0     | **是什么**：Stop 是立刻停下；Steer 是在智能体干活时补一句，不打断它。**为什么**：发现方向不对时，早纠正比事后返工省。**注意**：Stop 不会回滚已经完成的操作。**原理**：插话会在下一个步骤间隙交给模型。                                                                 |
| 6   | 项目与文件夹权限                   | P0     | **是什么**：项目就是智能体可以碰的文件夹集合，可设只读或读写。**为什么**：这是最根本的安全边界。**注意**：只放需要的文件夹；"No Project" 适合临时的小事。**原理**：沙箱按项目文件夹限制命令能访问的范围。                                                              |
| 7   | 记忆（Memory）                     | P1     | **是什么**：跨会话保存的笔记，分项目级和全局。**为什么**：不用每次重复交代偏好。**注意**：笔记可能记错（Unverified 标记），可以随时编辑或删除；可以整体关闭。**原理**：新会话开始时只读取笔记列表，用到时才读全文。                                                    |
| 8   | 子会话                             | P1     | **是什么**：智能体派出的"助手"会话。**为什么**：可以并行，也不会撑满主会话的上下文。**注意**：子会话的审批要去它自己的标签页里处理；它的审批模式不会比父会话宽松；多开不一定更好。**原理**：父会话读取子会话的回复后继续工作。                                         |
| 9   | Skills                             | P1     | **是什么**：可复用的"操作手册"。**为什么**：把反复交代的流程沉淀下来。**注意**：来源不明的 Skill 可能藏着危险指令。**原理**：平时只露出简介，用到时才加载全文。                                                                                                        |
| 10  | MCP 服务器                         | P1     | **是什么**：给智能体接上外部工具的插头。**为什么**：可以连接日历、数据库、各种 SaaS。**注意**：MCP 服务器以你的权限运行在沙箱外；结合 lethal trifecta 讲组合风险。**原理**：一个标准协议，服务器向智能体声明自己有哪些工具。                                           |
| 11  | 工作台：Artifacts / Preview / 版本 | P1     | **是什么**：右侧面板放交付物和预览。**为什么**：用户看结果，不用翻对话记录。**注意**：Artifacts 只列出提交的成果；保留了哪些版本、怎么恢复。**原理**：每次提交都会保存一份副本。                                                                                       |
| 12  | 工作风格与 Aldine 方法论           | P1     | **是什么**："完全接管"和"协作"两种分工；Aldine 方法论决定它会不会直言、反驳。**为什么**：按你的投入程度选择。**注意**：它们只影响说话和分工方式，不改变权限。                                                                                                          |
| 13  | 自动化（Automations）              | P1     | **是什么**：按定时、文件夹变化等触发器无人值守地运行。**注意**：只在 Pine 运行时执行；不读写记忆；按"完全接管"的工作风格运行；Secrets 只存在本机。                                                                                                                     |
| 14  | Scratch / 临时文件                 | P2     | **是什么**：智能体的草稿纸，放在项目的临时文件夹里。**注意**：不在你的项目目录里，可以清理；想保留的文件让它提交为 Artifact。                                                                                                                                          |
| 15  | 回复建议（Tab）                    | P2     | **是什么**：智能体回答完后，用另一个模型猜你下一句可能想说什么。**注意**：建议只是猜测，需要额外调用模型，可以关闭。                                                                                                                                                   |
| 16  | Optimize prompt                    | P2     | **是什么**：把随手写的话改写成清楚的任务说明。**注意**：`[[…]]` 处需要你自己补充；可以撤销。                                                                                                                                                                           |
| 17  | 侧边对话 / Follow up / 引用        | P2     | **是什么**：只读的旁支对话，不会打扰主任务。**注意**："整段对话"的侧边对话不会保存。                                                                                                                                                                                   |
| 18  | Computer Use 与浏览器              | P2     | **是什么**：智能体操作你的应用和网页。**注意**：授权只对当前任务有效；密码由你自己输入，智能体看不到；付款、发送这类操作要求它先问你，但这依赖它的判断。                                                                                                               |
| 19  | 实时上下文 Live context            | P2     | **是什么**：把会议或课堂的语音转成文字给智能体。**注意**：音频不保存；说话人标签可能出错。                                                                                                                                                                             |
| 20  | 远程控制 / 微信                    | P2     | **注意**：消息会经过腾讯服务器；最高审批模式怎么选；高风险操作的审批。                                                                                                                                                                                                 |
| 21  | 成本上限与货币                     | P2     | 可并入第 2 项，单独讲一页。                                                                                                                                                                                                                                            |

**前 10**：审批、上下文、模型/provider、推理强度、Stop/Steer、项目权限、记忆、子会话、Skills、MCP。

## 3. 设计方案

### 3.1 组件与交互（原型已实现）

- **`HelpGuideButton`**（`src/components/help/HelpGuideButton.vue`）：教程入口是一个带问号图标和文字的 ghost 按钮（如"上下文是怎么回事"），直接说明点开是什么，**不用悬停自动弹出 tooltip 的提示**。菜单里用同样形状的菜单项（如"审批模式怎么用"）。
  - 参数：`topic`、`label`，可选 `step`；点击前先触发 `@open`，让外层 popover 关闭。
  - 全局开关：Pine 设置 › 外观 › "图解教程按钮"（默认开启，多窗口实时同步）。关闭后，所有教程按钮和菜单项一起隐藏。
  - 设置页原有的 `HelpHint`（悬停 tooltip）只用来补充说明设置项，不承担教程入口。是否也改成按钮或行内说明，留到第二批统一处理。
- **`HelpTutorialDialog`**：整个窗口只有一个实例，挂在 `App.vue`，由 Pinia `useHelpStore().openTopic(id, step)` 驱动。
  - 布局：上方 13rem 的图示区（`bg-muted/60`）；下方是可滚动的文字区，依次是"教程名 · 第 n 步"、步骤标题、段落、要点列表、提示框（tip 用灯泡，caution 用琥珀色警告）；底部是步骤圆点（可点击跳转）、上一步、下一步/完成。
  - 左右方向键切换步骤（RTL 布局下方向互换）；超出范围的步骤号自动夹到最后一步；手机上全屏显示。
  - 深链：`openTopic("context-window", 2)` 可以直接打开到某一步。以后智能体、错误提示、更新说明都走这个入口。
- **入口（原型）**：审批模式菜单底部的"审批模式怎么用"，以及上下文用量弹窗里"立即压缩上下文"下方的"上下文是怎么回事"。

### 3.2 图示

- 每张图示是一个小 Vue 组件（`src/components/help/illustrations/`），用 lucide 图标、Tailwind 主题 token 和 scoped CSS keyframes 组合而成。**不用图片、Lottie 或视频**，每张只有几 KB。
- 颜色全部取主题变量（`--primary`、`--warning`、`--info`、`--foreground` 和 color-mix），自动适配深浅色和项目强调色。
- `prefers-reduced-motion` 时停止动画，停在"最终状态"：元素的基础样式就是最终画面，keyframes 只负责从隐藏态进入。
- 图示里尽量不放文字。需要文字时直接复用界面现有的 i18n 文案（如审批模式名、批准/拒绝按钮），保证和真实界面一致。
- 每切换一步都重新挂载图示，动画从头播放；整个对话框只挂载当前这一张。
- 后续可加入"可交互小演示"，例如拖动滑块看压缩前后的上下文变化。这类成本高，只给最核心的两三个主题做。

### 3.3 内容与 i18n

- 结构和文字分开：
  - `src/app/help/topics.ts`：主题 id、每个主题的步骤与图示的对应关系、类型定义。与语言无关。
  - `src/app/help/content/<locale>.ts`：纯文本（标题、一句话摘要、每步的段落/要点/提示）。用 `satisfies HelpContent` 做类型约束，测试会检查每种语言的步骤数和结构一致。
  - 对话框本身的按钮文案（上一步、下一步、完成等）进 vue-i18n，9 种语言都已翻译。
- **回退**：先写中文和英文；繁体中文回退到简体，其他语言回退到英文。对话框设置 `lang` 属性，标明正文实际使用的语言。后续由翻译批次逐个补齐语言，补一种加一个文件即可。
- 文案风格：第二人称、口语化、不用术语或在首次出现时解释；每步都有"原理一句话"或"注意"；界面元素名称使用当前语言的界面文案。基调乐观：先讲它能做成什么、怎么放手，风险具体到场景，不用泛泛的警告劝退用户。
- 中文排版：正文区使用 `text-wrap: pretty`（避免段末单字成行）和严格断行（避免句号等标点出现在行首）；写长句时也尽量控制长度，不依赖排版兜底。
- 内容不放进 vue-i18n 的理由：教程文本很长，而 `localeMessages` 要求 9 种语言结构完全一致，无法渐进补齐；分开存放也方便以后改为按语言懒加载。

### 3.4 与 `PINE_UI.md` / `activate_pine_ops` 联动

- **已做**：`PINE_UI.md` 新增 "Guide button" 概念和 "Guides" 一节，列出现有教程、入口和全局开关。智能体被问到"这个是什么"时，可以指引用户去点对应的教程按钮。
- **第二批建议**：新增工具 `ui_open_guide { topic, step? }`，与 `ui_workbench_*` 放在同一个工具组。它通过已有的 workbench 事件通道在渲染进程里调用 `openTopic`，不需要审批（只读、可关闭）。主题枚举直接取 `HELP_TOPIC_IDS`。系统提示加一句：用户对某个概念困惑时，可以打开对应教程。
- 可选：把教程正文作为第二份参考材料交给 `activate_pine_ops`，让智能体的解释和教程口径一致。体积会增大，等教程多起来再决定。
- 规则：新增或修改教程时，和 `PINE_UI.md` 在同一个提交里同步（沿用 AGENTS.md 的现有规则）。

### 3.5 其他帮助形式

| 形式                   | 做法                                                                                                                                                         | 成本                       | 收益                             | 建议                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | -------------------------------- | ------------------------ |
| 新会话空状态的示例任务 | "Dare the impossible" 下方放 3～4 张由浅入深的任务卡（只读整理 → 小改动 → 真实任务），点击填入输入框，不自动发送                                             | 低                         | 高：直接解决"不知道能让它做什么" | 第二批                   |
| 错误提示里的解释链接   | 上下文超限、成本上限、审批被拒、provider 无响应等提示加"了解原因"，深链到对应步骤                                                                            | 低（每处一行）             | 高：在出问题时讲最有效           | 第二批                   |
| "Agent 使用指南"总览页 | 设置里或"More"菜单里放一个"指南"入口，列出全部教程，再加一页"最佳实践"（一件事一会话、先说清边界、要求它给证据、审成果不盯过程、重复纠正就写进记忆或 Skill） | 中                         | 中高：给"能再找回"一个统一入口   | 第二批                   |
| 首次使用的轻量引导     | 不做长导览。首次打开时只在输入框上方显示一条可关闭的"第一次用？30 秒看懂 Pine"，点开就是"最佳实践"教程                                                       | 低                         | 中                               | 第二批                   |
| 首次出现时的提示气泡   | 第一次出现审批卡、第一次压缩、第一次派出子会话时，在旁边显示一次性提示，带"了解更多"                                                                         | 中（需要记录"已看过"状态） | 中                               | 第三批                   |
| 智能体主动教学         | 检测到用户在同一件事上反复纠正时，建议"要不要记进记忆或写成 Skill"                                                                                           | 中                         | 中                               | 第三批，需要系统提示配合 |
| 用户文档同步           | docs.aldine.cn 增加"概念"栏目，复用教程文本                                                                                                                  | 中                         | 中                               | 教程稳定后做             |

## 4. 分批计划

- **第一批（本次）**：基础设施，以及"工具调用与审批""上下文与 token"两个主题，中英文。✅
- **第二批（P0 补齐 + 联动）**：模型/provider、推理强度、Stop/Steer、项目权限四个主题；`ui_open_guide` 工具；空状态示例任务；错误提示深链；在设置页相关设置项旁加教程按钮（自动审批路径 → 审批主题；压缩策略 → 上下文主题第 3 步）。约 2～3 天。
- **第三批（P1）**：记忆、子会话、Skills、MCP、工作台、工作风格与 Aldine、自动化；"指南"总览页和"最佳实践"页；首次出现时的提示气泡。约 3～4 天。
- **第四批（P2 + 翻译）**：剩余主题；其余 7 种语言的教程正文；docs 仓库同步。

每批都要做：用户可见的改动同步 `PINE_UI.md`；跑 focused tests、eslint、typecheck；进入发布时写 CHANGELOG（中英各一条）。

## 5. 已知限制与待定

- 原型没有在运行中的应用里做视觉检查（避免与用户正在运行的 Pine 实例冲突）。合并前建议协调者用 dev 实例看一眼两张教程在深浅色下的效果，以及动画节奏。
- 繁体中文暂时显示简体正文，是否接受这个过渡方案需要确认。
- 审批卡片本身要不要也放一个教程按钮（目前只放在菜单里），等第二批统一决定。
