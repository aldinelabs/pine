# Changelog

All notable changes to Pine are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Starting with 0.4.4, release notes are written in both Chinese and English.
从 0.4.4 起，发布记录使用中英双语。

## [Unreleased]

### 新增 / Added

- Pine 启动后直接进入工作区，不再先显示项目列表。新会话通过输入框中发送按钮左侧的项目选择器决定所在项目。“无项目”用于不属于任何项目的临时工作，会话保存在 Pine 的数据目录中，不能重命名、修改或删除。Pine now opens straight into the workspace instead of a project list. A new session picks its project from the project picker beside the send button. No Project keeps work that belongs to no project in Pine's data directory and cannot be renamed, edited, or deleted.
- 在新会话的空输入框中先输入 @，输入框会切换为项目名称并实时提示匹配的项目（左侧图标变为 @）：按 ↑/↓ 切换、回车选定，选定的项目会移到发送按钮旁的项目选择器中；按 Esc 或在空输入框中按退格返回消息输入。“无项目”的图标为 @。新会话默认使用你上一次选择的项目，最初是“无项目”。In a new session, typing @ first in the empty input switches it to a project name with live suggestions (its icon becomes @): use ↑/↓ to move and Enter to choose, and the chosen project moves into the picker beside Send; press Esc, or Backspace in the empty input, to return to the message. No Project's icon is @. New sessions start in the project you chose last, initially No Project.
- 一个窗口中的标签页可以来自不同项目。切换标签页时，左右侧栏、强调色和窗口标题会随当前标签页的项目切换，已打开项目的侧栏状态会保留。Tabs in one window can now come from different projects. Switching tabs moves the sidebars, accent color, and window title to that tab's project, and each open project keeps its sidebar state.
- “无项目”中的会话可以让 Agent 列出你的项目，并在征得你确认后把会话移动到某个项目中，之后在该项目的文件夹中继续。In a No Project session, the agent can list your projects and, after you confirm, move the session into one of them so it continues in that project's folders.
- 项目可以设置图标：在项目设置中点击名称左侧的图标，从一组图标中选择；项目选择器和“项目管理”列表会显示该图标。Projects can now have an icon: click the icon left of the name in project settings to pick one, and it shows in the project picker and the Projects list in Settings.
- 在会话页面按 ⌘L / Ctrl+L 可以随时聚焦消息输入框。On a session page, press ⌘L / Ctrl+L to jump to the message input at any time.
- 设置中新增“项目管理”：列出所有项目，可以新建、编辑项目，并查看 Pine 为每个项目保存的会话、临时文件、附件和搜索缓存占用；临时文件和附件可以单独清理。Settings now include Projects: every project in one list, where you can create and edit projects, see how much space Pine uses for each project's sessions, temporary files, attachments, and search cache, and clear temporary files or attachments.

### 变更 / Changed

- 只有一个文件夹的项目（包括“无项目”），左侧文件栏直接平铺显示其中的文件和子文件夹，不再多出一层根目录；添加了额外上下文文件夹的项目保持原样。For projects with a single folder (including No Project), the Files sidebar lists its files and subfolders directly without an extra root row; projects with additional context folders look as before.
- 删除项目改在项目设置对话框中进行。Deleting a project now happens in the project settings dialog.
- 升级后，此前各项目中打开的标签页不会恢复，工作区从一个新会话开始。After updating, tabs previously open in each project are not restored; the workspace starts with a new session.

### 修复 / Fixed

- 切换到使用强调色的项目时不再明显卡顿，与切换到默认配色的项目一样快。Switching to a project with an accent color no longer stutters; it is as fast as switching to one with the default colors.
- ⌘W / Ctrl+W 重新只关闭当前标签页，⌘T / Ctrl+T 重新可以新建会话；没有标签页时 ⌘W 才关闭窗口。⌘W / Ctrl+W closes the current tab again, and ⌘T / Ctrl+T opens a new session again; ⌘W closes the window only when no tabs are left.
- 关闭最后一个标签页后，左侧栏和强调色会回到“无项目”，不再停留在刚关闭的标签页所属的项目。After the last tab closes, the sidebars and accent color return to No Project instead of staying on the closed tab's project.
- 在文件栏中误拖动项目根目录，或把文件夹拖到自己（或自己的子文件夹）上并放下时，不再弹出 “Cannot move…” 错误，操作会被直接忽略。Dropping a project's root folder, or a folder onto itself or its own subfolder, after an accidental drag in the Files sidebar no longer shows a "Cannot move…" error; the drop is simply ignored.

## [0.8.1] - 2026-10-02

### 新增 / Added

- 偏好设置新增“上下文压缩途径”：默认由大模型撰写摘要；也可选择“语义化算法（Beta）”，不调用模型，直接从对话中提取目标、文件改动、提交和简要记录，压缩更快且不消耗 Token。Preferences now include a context compaction method: by default the model writes the summary, or you can choose the Semantic algorithm (Beta), which extracts goals, file changes, commits, and brief notes from the conversation without a model call, so compaction is faster and uses no tokens.
- 选择语义化算法后，Agent 可在压缩后的对话中查找更早的历史记录；对话中以独立图标显示查找的关键词、改动过的文件或最近的记录。With the semantic algorithm selected, the agent can look up earlier history after compaction; these lookups appear in the conversation with their own icon, showing the query, touched files, or recent entries searched.

### 变更 / Changed

- Agent 的任务清单更有针对性：只在多步骤、中高复杂度的工作中创建，并拆成具体步骤，在工作过程中持续更新，避免为简单请求创建清单或长期不更新。The agent's task list is now more selective: it is created only for multi-step, medium-to-high complexity work, split into concrete steps, and kept current as the work progresses, instead of appearing for simple requests or going stale.
- 基于决策模型的自动审批路径现标注为 Beta；模型目录说明更简短，执行环境设置项的顺序也已重新整理。The Decisions-based automatic approval path is now labeled Beta; the model catalog description is shorter, and the execution environment settings are reordered.

### 修复 / Fixed

- 只包含附件、没有文字的消息现在会在对话大纲中显示“[附件]”，不再是空白条目。Messages containing only attachments now appear as “[Attachment]” in the conversation outline instead of a blank entry.
- 鼠标滚轮停在没有溢出内容的消息气泡上时，现在会继续滚动整个对话。Scrolling with the mouse wheel over a message bubble that has no overflowing content now scrolls the conversation instead of stopping.
- 技能管理对话框不再被较长的技能列表撑大。The skill manager dialog no longer stretches when the skill list is long.

## [0.8.0] - 2026-10-02

### 新增 / Added

- 项目工作区现在包含右侧栏，可并排查看 Agent 的任务清单和后台命令；任务依赖以图形呈现，后台命令支持查看实时日志、停止运行，并在完成后收到对话通知。Project workspaces now include a right sidebar for the agent's task list and background commands. Task dependencies appear as a graph; background commands provide live logs, can be stopped, and notify you in the conversation when they finish.
- Agent 可维护跨会话保留的任务清单，展示多步骤工作的进度和依赖关系；点击任务清单可查看按状态分组的全部任务。The agent can maintain a task list that persists across conversations, showing progress and dependencies for multi-step work; click the list to view all tasks grouped by status.
- 可以编辑已发送的用户消息，并从该消息处重写会话历史、继续对话。You can edit a sent message and rewrite the conversation from that point, then continue chatting.
- 项目空状态会根据侧栏内容展示相应预览，帮助识别可用的工作区功能。Project empty states now show previews tailored to the sidebar content, helping you discover workspace features.
- 侧栏底部现在显示 Pine 的应用版本。The Pine app version is now shown at the bottom of the sidebar.

### 变更 / Changed

- 项目工作区调整为适配侧栏的新布局；标签栏、新建标签按钮和右侧栏间距经过整理。The project workspace now uses a layout designed for its sidebars, with a refined tab bar, new-tab button, and right-sidebar spacing.
- “工作技能”和“MCP 服务器”入口从左侧栏底部移至右侧栏底部。Work Skills and MCP Servers moved from the bottom of the left sidebar to the bottom of the right sidebar.

### 修复 / Fixed

- 暗色模式下，Markdown 中的表格表头、行内代码、代码块和图表现在跟随当前项目配色，不再显示为橄榄绿。In dark mode, Markdown table headers, inline code, code blocks, and diagrams now follow the current project color instead of appearing olive green.
- 修复右侧栏、窗口缩放和全屏切换时的布局问题，并让新建项目页背景与主题保持一致。Fixed layout issues with the right sidebar, window resizing, and full-screen changes; the new-project background now matches the active theme.
- 改进长对话的消息渲染和可见区域跟踪，减少滚动与切换会话时不必要的更新。Improved message rendering and visibility tracking in long conversations, reducing unnecessary updates while scrolling or switching sessions.
- 修复任务清单空状态提示、标签页及后台命令详情中的若干显示问题。Fixed several display issues in the task-list empty state, tabs, and background-command details.

## [0.7.2] - 2026-10-01

### 修复 / Fixed

- Markdown 文件预览现在能显示相对于文档目录引用的本地图片；聊天中的本地绝对路径和 `file://` 图片也能正常显示。Markdown file previews now display local images referenced relative to the document directory; local absolute-path and `file://` images in chat also display correctly.

## [0.7.1] - 2026-10-01

### 修复 / Fixed

- Markdown 中的代码块、表格、提示块、图表和工具提示现在跟随 Pine 当前主题使用一致配色，嵌套内容也能清晰显示。Markdown code blocks, tables, callouts, diagrams, and tooltips now use consistent colors from Pine’s active theme, including nested content.
- MCP 工具请求审批时，审批卡片和状态现在会关联到发起调用的 MCP 工具，并在审批完成后正确更新。Approval cards and status for MCP tool requests now appear on the parent MCP call and update correctly after a decision.
- 曾编辑过上下文的旧会话现在可恢复打开、搜索和导出，并保留原始消息与上下文编辑；重命名后仍可继续对话。Older conversations with context edits can now be opened, searched, and exported while preserving original messages and context edits; they remain resumable after renaming.
- 单个会话文件读取失败不再阻止同项目其他会话显示和更新。An unreadable conversation file no longer prevents other conversations in the same project from appearing or updating.
- 文件预览现在会自动刷新项目文件和临时文件；刷新 Markdown 或源码时保留滚动位置和显示模式。File previews now refresh automatically for project and temporary files, while Markdown and source views keep their scroll position and display mode.

## [0.7.0] - 2026-10-01

### 新增 / Added

- 自动审批默认由大模型审核，并新增可选的 Decisions 初筛路径：批准直接放行，需要用户确认时直接显示确认卡片；拒绝或初筛不可用时由大模型复核，可重新批准、拒绝或请求用户确认，并提供理由。全局偏好设置可切换审批路径，从自动同步的模型目录选择 Jev、Solar Decide、Span-01 等初筛模型。Automatic approval continues to use model review by default, with an optional Decisions screening path: allow proceeds directly, and needs_user opens a confirmation card. Denied calls or unavailable screening go to the review model, which can approve, deny, or request user confirmation and provide a rationale. Global preferences offer a path switch and an automatically updated catalog of screening models including Jev, Solar Decide, and Span-01.
- 全局偏好设置可选择 Pine 默认强调色，提供八种配色；新项目和未单独设置颜色的项目会使用该配色。Global preferences now let you choose Pine’s default accent from eight themes; new projects and projects without their own accent use that color.

### 变更 / Changed

- 点击读取、写入或打开文件的工具标记时，现在会直接在 Pine 中预览文件；历史调用也可重新打开仍存在的呈现文件。Clicking a read, write, or present-file tool marker now opens the file preview in Pine; historical calls can also reopen presented files that still exist.
- 工具详情会按工具类型呈现：编辑显示代码差异，网页搜索结果使用表格；状态和审批信息布局更紧凑，对话框宽度会随内容调整。Tool details now match each tool: edits show code diffs and web search results use a table. Status and approval information use a more compact layout, and the dialog width adjusts to its content.
- 决策模型审批现在明确区分已授权的常规开发、验证与诊断，以及需要额外同意的操作；减少仅因越过沙盒边界或未逐条指定命令而重复确认的倾向，判断不清时优先交由大模型复核。Decision model screening now more clearly distinguishes authorized development, validation, and diagnosis from actions requiring additional consent, aiming to reduce redundant confirmations caused by sandbox boundaries or exact command wording. Ambiguous screening is directed to model review.
- 自动审批失败后，手动确认卡片会标明失败原因，并通过通知显示具体错误；较长的审批内容可在卡片内滚动，操作按钮始终可见。When automatic approval fails, the manual review card now identifies the fallback and a notification shows the specific error. Long approval content scrolls within the card while decision buttons stay visible.
- Decisions 初筛模型选择移至图像生成模型下方，并在大模型审批路径下显示为禁用；对应审批路径选项改名为“基于决策模型”。The Decisions screening model selector now appears below the image generation model and remains visible but disabled when using model review. Its approval path option is now named “Decision model”.
- 通用设置中的诊断日志说明移至帮助图标提示中。The diagnostic logging description in General settings now appears in a help tooltip.
- 会话页背景图标和 Markdown 链接现在使用当前强调色；Markdown 正文中的美元符号和 `(c)` 会按原文显示，不再被误解为数学标记或自动替换。Session background icons and Markdown links now follow the active accent color. Dollar signs and `(c)` in Markdown prose are preserved instead of being mistaken for math delimiters or automatically replaced.

## [0.6.5] - 2026-09-29

### 新增 / Added

- 偏好设置新增可选诊断日志，帮助排查项目通信与电脑睡眠、唤醒问题。Preferences now include optional diagnostic logging to help troubleshoot project communication and sleep or wake issues.

### 变更 / Changed

- 多个会话现在可以同时运行；切换或新建 tab 不会中断其他会话，每个 tab 保留自己的对话、运行状态和待处理请求。Multiple sessions can now run concurrently; switching or creating a tab no longer interrupts other sessions, and each tab keeps its own conversation, run status, and pending requests.
- Markdown 现在可以安全显示 `details`、`summary` 等结构化 HTML，表格中的长行内代码也会在自然分隔处换行。Markdown now safely renders structural HTML such as `details` and `summary`, and long inline code in tables wraps at natural break points.

### 修复 / Fixed

- 修复“推荐”压缩策略在会话启动或设置更新后失效的问题；大上下文模型现在会在超过 400K tokens 时自动压缩。Fixed the Recommended compaction strategy becoming inactive after session startup or settings updates; models with large context windows now compact automatically above 400K tokens.
- 修复滚动查看较早消息时，对话末尾的预留空白无法及时收缩的问题。Fixed excess blank space at the end of a conversation while scrolling back through older messages.
- 修复助手进程输出较多时可能被阻塞的问题。Fixed an issue that could stall the assistant when its process produced a large amount of output.
- 修复连续批准请求中的后续卡片无法操作的问题；批准快捷键现在只作用于当前 tab。Fixed later cards in a sequence of approval requests becoming unresponsive; approval shortcuts now apply only to the active tab.

## [0.6.4] - 2026-09-27

### 修复 / Fixed

- 修复手动压缩期间发送追加消息偶尔报错、未进入队列的问题；消息现在会在压缩完成后继续处理。Fixed an intermittent failure that kept steer messages sent during manual compaction out of the queue; queued messages now continue after compaction completes.

## [0.6.3] - 2026-09-25

### 新增 / Added

- 项目现在可以单独选择强调色，提供八种配色。Projects can now have their own accent color, with eight themes to choose from.
- 技能管理器现在可发现 Pi 提供的全局和项目 Skill；本地 Skill 可编辑，包内 Skill 以只读方式显示。The Skills manager now discovers global and project Pi skills; local skills can be edited, while package-provided skills are shown as read-only.

### 变更 / Changed

- 个人资料仍会自动保存，但编辑时不再显示未保存或已自动保存状态。Profiles continue to save automatically, without unsaved or automatically saved status messages while editing.

### 修复 / Fixed

- 上下文压缩期间发送的消息现在会排队，并在压缩完成后继续处理。Messages sent while context is being compacted are now queued and processed after compaction completes.
- 修复 MCP 服务器编辑窗口标题缺失，并调整删除按钮的位置。Restored the MCP server editor title and corrected the delete button alignment.

## [0.6.1] - 2026-09-25

### 修复 / Fixed

- 修复打包版中 MCP 服务器无法正常使用的问题。Fixed MCP servers failing to run in the packaged app.

## [0.6.0] - 2026-09-25

### 新增 / Added

- 新增 MCP 服务器管理，可配置项目级或全局服务器，让 AI 在会话中使用外部工具。Added MCP server management for project-level or global servers, making external tools available to the AI during sessions.

### 变更 / Changed

- 切换模型时保留各模型原有的上下文压缩设置。Model-specific context compaction settings are now preserved when switching models.

### 修复 / Fixed

- 恢复侧栏顶部拖动窗口的功能。Restored window dragging from the top of the sidebar.

## [0.5.4] - 2026-09-23

### 修复 / Fixed

- 修复打包版无法打开会话的问题。Fixed an issue that prevented sessions from opening in the packaged desktop app.

## [0.5.3] - 2026-09-23

### 新增 / Added

- 新增“自主工作”权限模式：AI 可自行审核工作区外的操作；理由不足时会指出疑点供助手补充，避免等待用户逐次批准。Added Autonomous Work mode: AI reviews operations outside the workspace and identifies gaps in the agent's rationale so work can continue without per-call user approval.

### 变更 / Changed

- 切换权限模式后，助手会在后续对话中收到当前模式的最新说明；按需启用的工具也会随对话恢复。After switching permission modes, the assistant receives the current mode's instructions in subsequent conversation, and tools activated on demand are restored with the conversation.
- “自主工作”模式下，助手等待问题回复达到设定时间后会收到超时提示并继续处理；模式选择器也改用独立图标和更明确的说明。In Autonomous Work mode, the assistant receives a timeout notice and can continue after the specified wait for a question reply; the mode selector now has a distinct icon and clearer descriptions.

## [0.5.2] - 2026-09-20

### 新增 / Added

- 图像生成现在支持文本加多张参考图：可直接使用会话附件、本地路径、HTTP(S) 图片 URL 或 base64 data URL，并按所选模型的输入能力发送到 OpenRouter。Image generation now supports text with multiple reference images: use session attachments, local paths, HTTP(S) image URLs, or base64 data URLs, with each request routed according to the selected model's input capabilities.

## [0.5.1] - 2026-09-19

### 修复 / Fixed

- 安装版里缺失最新图像模型的问题：模型选择器现在能看到 GPT Image 2.5 系列等新上线的图像模型。The installed app no longer misses the newest image models: the model picker now offers the GPT Image 2.5 family and the models released alongside it.

### 变更 / Changed

- 模型选择器更流畅：长列表只渲染屏幕内可见的模型，滚动和打开都更跟手；模型列表没有变化时不再重复加载。The model picker is smoother: long lists render only the models on screen, scrolling and opening feel more responsive, and an unchanged model list is no longer reloaded.

## [0.5.0] - 2026-09-19

### 新增 / Added

- 新增 AI 图像生成：常驻的 `activate_media_generation` 工具按需启用 `generate_image`，模型可以写提示词、设置参数并把图片生成到项目文件中。Added AI image generation: the always-visible `activate_media_generation` tool enables `generate_image` on demand, so the model can write prompts, set parameters, and save generated images as project files.
- 重写全局偏好设置为左侧分类、右侧选项的对话框，改为用户画像、模型与图像模型、执行环境等分组，并加入图像模型选择器。Rebuilt global preferences as a sectioned dialog with a category rail on the left and options on the right, covering the user profile, models and the image model, and the execution environment.

### 变更 / Changed

- 生成的图片不再自动用预览器打开；需要呈现给用户时，模型会先把文件放到与 Pine 共享的目录再调用呈现工具。Generated images are no longer opened in a preview automatically; to show one, the model first copies the file into a folder shared with Pine and then calls the presentation tool.
- 图像生成始终使用用户在设置中选择的模型，模型自身无法指定其它图像模型。Image generation always runs on the model the user picked in settings; the model itself cannot name a different image model.
- 新会话页背景视差增强上下方向的阻力，拉开图标之间的不透明度层次；Harness 分组本地化为“执行环境”。The new-session parallax now damps vertical travel harder and spreads icon opacity more clearly; the Harness section is localized as 执行环境.
- Pi 的模型目录可以在 Pi 发版前单独刷新（构建与发版仍基于 npm 上已发布的包），新模型不必等到下一个 Pi 版本。Pi's model catalogs can now be refreshed ahead of a Pi release while builds stay on the published npm packages, so new models no longer wait for the next Pi version.

### 修复 / Fixed

- 修复 OpenRouter 纯图像模型（如 `openai/gpt-image-2.5-flare`）报 “cannot be used with the chat/completions endpoint” 而无法出图的问题，改走 OpenRouter 专用图像 API。Fixed pure image models on OpenRouter (for example `openai/gpt-image-2.5-flare`) failing with "cannot be used with the chat/completions endpoint"; they now use OpenRouter's dedicated image API.
- 修复项目选择页背景动画让 CPU 持续接近 100% 的问题，只重绘发生变化的格子。Fixed the project start page background animation pegging the CPU near 100% by repainting only the cells that change.
- 修复呈现文件时 `project-files:preview-presented` 没有处理函数导致的报错。Fixed the `project-files:preview-presented` error thrown when presenting a file.

## [0.4.8] - 2026-09-18

### 新增 / Added

- 新增了通过拖拽的方式将对话归类到分组的功能。Added the ability to categorize conversations into groups via drag-and-drop.

### 修复 / Fixed

- 修复了自定义提供商和自定义模型无法被用户编辑或者删除的问题。Fixed an issue where custom providers and custom models could not be edited or deleted by the user.

### 变更 / Changed

- 更换了部分图标，优化视觉。Replaced some icons and optimized the visual design.

## [0.4.7] - 2026-09-17

### 修复 / Fixed

- 保留向下滚动意图下的跟随模式。Preserved follow mode on downward scroll intent.

## [0.4.6] - 2026-09-17

### 变更 / Changed

- 新增会话分组管理能力。Added session group management.

### 修复 / Fixed

- 解码 Markdown 图片路径中的百分号编码。Decode percent-encoded Markdown image paths.
- 要求明确意图后才能停止思考跟随。Require explicit intent before stopping thinking follow.

## [0.4.5] - 2026-09-17

### 修复 / Fixed

- 修复从 transcript outline 首次点击较早消息时无法完成跳转的问题，并让弹出的消息列表自动定位到当前用户消息。Fixed transcript outline navigation so the first click reaches earlier messages, and keep the popup list aligned with the current user message.

## [0.4.4] - 2026-09-16

### 新增 / Added

- 图片、HTML 等可视预览支持触控板缩放，并可平移放大后的图片。Visual previews such as images and HTML now support trackpad zoom, with panning for enlarged images.
- 新会话背景增加更均衡的图标布局和办公任务图标候选，并优化带轻微模糊的入场动画。The new-session background gains a more balanced icon layout, office-task icon candidates, and a refined entrance with subtle blur.

### 修复 / Fixed

- 切回正在流式输出的会话时，自动刷新到最新内容。Returning to a streaming session now refreshes it to the latest content automatically.
- 关闭标签页时保留横向滚动缓动和标签补位动画，并修复顶栏部分空白区域无法拖动窗口的问题。Closing tabs now preserves horizontal scroll easing and tab movement; empty title-bar areas remain draggable.
- 修复消息流式输出、窗口缩放和思考内容展开时的滚动跟随与动画。Fixed scroll following and animation during streamed messages, window resizing, and thinking expansion.
- 发送消息后，新会话背景图标立即消失。The new-session background icons now disappear immediately when a message is sent.

## [0.4.3] - 2026-09-16

### Added

- Added an expandable file tree accordion with parallax and flickering-grid visuals.

### Changed

- Refined project session presentation and thinking markers.

## [0.4.2] - 2026-09-16

### Fixed

- Render markdown inline images: remote URLs load directly and local absolute or `file://` paths are served through the validated `pine-attachment://` protocol.

### Changed

- Contain offscreen transcript layout and batch streamed updates at 120ms, ending sustained high CPU during long streaming sessions; new stream deltas fade in so the sparser cadence still reads as continuous typing.
- Render thinking blocks through the markdown pipeline with a compact, muted panel variant.

## [0.4.1] - 2026-09-16

### Changed

- Improved streamed update handling across agent messages and runtime state.
- Refined the skill manager dialog layout.

## [0.4.0] - 2026-09-15

### Added

- Global and project skills, with localized skill activity in the transcript.
- Persistent approval state and execution cache-hit reporting.
- Native dragging of project files into Pine.

### Changed

- Optimized streaming transcript rendering and preserved project library order.

### Fixed

- Improved file presentation summaries and handling of missing Computer Use parameters.

## [0.3.1] - 2026-09-14

### Fixed

- macOS packages now receive a complete ad-hoc signature whose identity is
  bound to Pine's bundle metadata, so the computer-use helper resolves the
  same Accessibility permission entity that System Settings grants.

## [0.3.0] - 2026-09-14

### Added

- Native computer-use controls with visible review flow and bundled platform
  runtimes for macOS and Windows.
- Background file presentation, reusable attention flashes, and clearer agent
  execution-resource and user-question guidance.
- A discrete reasoning-effort slider with animated thumb/range movement and
  thumb-anchored warning tooltips.

### Changed

- Project opening now disables the project library until loading and navigation
  finish, preventing competing interactions during the transition.
- Opening a project that is already owned by another Pine window focuses that
  window instead of creating a duplicate project runtime.
- Computer Use activation now persists for the full session, including when a
  saved session is reopened.

### Fixed

- CI desktop packaging now builds the native computer-use runtime before
  Electron Forge packages the application.

## [0.2.2] - 2026-09-14

### Added

- Bundled Sarasa Gothic SC CJK subsets as the global UI fallback after Inter,
  with Regular, SemiBold, and Bold weights.
- Documented platform support levels for macOS, Windows, and Linux.

### Changed

- Coalesced redundant sandbox file operations so Windows read/write calls launch one file worker
  and edit calls launch two, without weakening path authorization or final-file checks.
- Windows startup now completes required sandbox provisioning before opening the main window.

### Fixed

- Prevented repeated Windows sandbox setup prompts and access-denied process launches by granting
  the sandbox broker read and execute access while keeping its runtime directory protected.
- Kept Windows title-bar controls aligned with Pine's custom layout.
- Kept macOS sandbox control sockets on a short system path so deeply nested project temporary
  directories no longer break shell commands and file tools.

### Known issues

- Windows sandboxed file workers still have roughly 1.7 seconds of measured startup latency per
  process; persistent file workers require a follow-up design before sub-second file tools are possible.

## [0.2.1] - 2026-09-13

### Added

- Windows x64 desktop distribution with Squirrel installation and update support.

## [0.2.0] - 2026-09-13

### Added

- Structured user questions: the agent can present multiple-choice questions with options,
  descriptions, and previews, answered directly from the conversation.
- Each conversation now remembers its own model and provider selection.

### Fixed

- Refined the presentation of question cards and tool-call markers in the transcript.

## [0.1.2] - 2026-09-12

### Added

- A titlebar button that closes the active project and returns to the project list.

### Changed

- Sidebar conversations are grouped into past three days, past week, past month, and older sections.
- Conversation rows no longer show a date, leaving the full row width to titles.

## [0.1.1] - 2026-09-12

### Fixed

- Preserved Electron's built-in SQLite module in production bundles so projects can open correctly.
- Removed a blocked remote font request and kept the bundled Inter variable font as the UI font source.

## [0.1.0] - 2026-09-10

### Added

- A local-first Electron workspace for project-scoped AI agent sessions.
- Project file browsing and previews for text, image, PDF, Word, Excel, and PowerPoint files.
- Review, auto-approve, and unrestricted execution modes with visible tool activity.
- Configurable model providers, custom models, themes, localization, and persistent sessions.
- Reproducible main-branch artifacts and a manually gated production release workflow.
- R2-backed update discovery, verified downloads, and in-app macOS replacement updates.

[Unreleased]: https://github.com/phosphoros-works/pine/compare/v0.7.0...HEAD
[0.6.4]: https://github.com/phosphoros-works/pine/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/phosphoros-works/pine/compare/v0.6.1...v0.6.3
[0.6.1]: https://github.com/phosphoros-works/pine/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/phosphoros-works/pine/compare/v0.5.4...v0.6.0
[0.5.4]: https://github.com/phosphoros-works/pine/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/phosphoros-works/pine/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/phosphoros-works/pine/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/phosphoros-works/pine/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/phosphoros-works/pine/compare/v0.4.8...v0.5.0
[0.4.8]: https://github.com/phosphoros-works/pine/compare/v0.4.7...v0.4.8
[0.4.7]: https://github.com/phosphoros-works/pine/compare/v0.4.6...v0.4.7
[0.4.6]: https://github.com/phosphoros-works/pine/compare/v0.4.5...v0.4.6
[0.4.5]: https://github.com/phosphoros-works/pine/compare/v0.4.4...v0.4.5
[0.4.4]: https://github.com/phosphoros-works/pine/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/phosphoros-works/pine/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/phosphoros-works/pine/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/phosphoros-works/pine/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/phosphoros-works/pine/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/phosphoros-works/pine/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/phosphoros-works/pine/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/phosphoros-works/pine/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/phosphoros-works/pine/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/phosphoros-works/pine/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/phosphoros-works/pine/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/phosphoros-works/pine/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/phosphoros-works/pine/releases/tag/v0.1.0
