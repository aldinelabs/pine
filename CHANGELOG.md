# Changelog

All notable changes to Pine are documented in this file.
中文版本见 [CHANGELOG.zh-CN.md](./CHANGELOG.zh-CN.md)。

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Every release section here has a matching section in the Chinese changelog.

## [Unreleased]

## [0.24.0] - 2026-11-22

> **Highlights**: Illustrated guides explain Pine's features, opened from buttons in menus, settings and managers or from the Guides overview in the sidebar, with one-time tips where a feature first appears; Settings gains an About page with open-source licenses; artifacts can be filed into folders; the quick composer can send in the background and notify you when the answer is ready.

### Added

#### Guides

- **Illustrated guides**: Animated pictures and plain-language steps explain tool calls and approvals, context and tokens, models and providers, reasoning effort, steering and stopping, projects and folder access, memory, sub-sessions, the workbench, work style and Aldine methodology, Skills, MCP servers and automations, plus "Working well with an agent". They open from the approval mode menu, the model menu, the Context usage popover and a button beside the Automations, Skills, MCP servers and Memory titles; the question marks beside the approval path and context compaction settings open one-page guides comparing the options. Guides are written in Simplified Chinese and English.
- **Guides overview**: Guides in the sidebar's More menu lists every guide by topic; a guide opens on top of the list and closing it returns there.
- **One-time tips**: The first time you meet an approval card, a context compaction, Artifacts, sub-sessions, an automation run, memory, a Skill, an MCP tool, a stop or staged steering, a short tip with "Show me" and "Got it" appears beside it, and never again once dismissed. Settings › General › One-time tips › Show again brings them back.
- **Explanations when something is blocked**: A tool call blocked by the approval model or the sandbox offers "Why was this blocked?" in its details, and the cost limit notice offers "Learn why"; both open the guide step that explains it.
- **The agent can open guides**: When you're unsure how a feature works, the agent can open the relevant guide at the right step for you; the conversation shows "Opened the “…” guide".
- **Hide guide buttons**: Guide buttons in Settings › General, on by default, hides every guide button and one-time tip in every window when turned off.

#### Settings

- **About page**: Settings ends with About: Pine's version, links to the documentation, source code, release notes and issue reporting, Check for updates, Pine's AGPL license and the open-source software Pine ships or adapted, searchable by name or license, with each entry opening its project page in the browser.

#### Workbench and files

- **Artifacts in folders**: The agent can file artifacts into folders (such as "Reports/Week 1"), and the workbench Artifacts list shows them as a collapsible tree whose open folders are remembered per session. Folders only group the list and never move files; earlier artifacts stay at the top level. Added, moved and removed files fold smoothly in and out.
- **Drag artifacts out**: Files in the Artifacts list can be dragged like file tree entries, into the composer, the file tree, or onto the desktop and other apps.
- **Context menu on images and videos**: Right-clicking an image or video shows the system menu with Copy Image, Save As…, Copy File Path or Copy Address, Show in Finder and, on macOS, Share.

#### Quick composer and windows

- **Send from the quick composer in the background**: `⌃/Ctrl + Enter` (`Alt + Enter` on Windows and Linux) in the quick composer hides it at once and starts the conversation in the background without bringing a Pine window forward. When the answer is ready or fails, a system notification tells you, even with "Signal when work is done" set to Off; clicking it opens the conversation.
- **Close the window with `⌘/Ctrl + Shift + W`**: It works the same as the window's close button.

### Changed

- **The quick composer's context holds its place and has a ×**: As soon as the quick composer appears, a grey placeholder holds the context strip's place and the screenshot and app name fill it in where it stands; the × at its right end removes the context, and removing it while it is still being captured discards the capture.
- **Tool parameters and results shown as JSON**: Tool call details no longer flatten parameters into rows like `files[0].path`; they show indented, syntax-highlighted JSON with long lines wrapped, and results that are themselves JSON show the same way, while plain text and Markdown results are unchanged.

### Fixed

- Images the agent saved in the project's temporary folder now show in interactive answers and open from tool calls instead of failing to load.
- Switching sections in Settings now starts the new section at its top instead of keeping the previous section's scroll position.
- Picking or creating a Skill in the Skills manager now starts the editor at its top instead of keeping the previous Skill's scroll position.
- The empty Skills and MCP servers managers no longer repeat the dialog's own buttons in their empty space.

## [0.23.0] - 2026-11-20

> **Highlights**: Several people can now have their own Pine on one computer and pick who's using it at launch; Work style and the Aldine methodology (Beta) set how Pine drives a task and how it talks; the agent can choose a sub-session's model and stop other sessions, and asks you first after you stop a sub-session yourself; Monet now only changes the font.

### Added

#### Multiple users

- **Several users on one computer**: Settings › Multiple users adds users, each with their own conversations, projects, memory, Skills, MCP servers, automations, remote control and WeChat bindings, model connections and settings. Users have no passwords; this keeps things apart, not private. "Copy my model connections" is on by default when adding a user, and deleting a user moves their data to the Trash. With a single user nothing changes apart from that Settings section.
- **Choose the user at launch**: With more than one user, Pine opens on "Who's using Pine?", where arrow keys or `1`–`9` pick a user and Add user adds one. "Remember my choice on this computer" makes Pine open as whoever used it last; turning "Ask who's using Pine when it opens" back on in Settings › Multiple users brings the question back.
- **Switch users from the sidebar and the tray**: With more than one user, the sidebar footer shows the current user's avatar with a menu to switch or manage users, and the menu bar (notification area on Windows) menu lists every user. Switching restarts Pine as that user, asking first if sessions are running or remote control is on. Only the current user's automations and WeChat remote run.

#### How the agent works

- **Work style**: Settings › User profile gains Work style. Full takeover, the default, has Pine drive the task itself and quote or summarize the parts of a file it discusses, so you don't need the file open beside the chat; Collaborate assumes you have the file open, so Pine points to sections, paragraphs or line numbers, keeps you in the loop and asks before key decisions. Automations always run as Full takeover.
- **Aldine methodology (Beta)**: A new "Aldine methodology" switch at the top of Settings › User profile, on by default, makes Pine talk like a clear-headed dialogue partner: candid, specific and light on pleasantries, agreeing only when it means it, saying exactly what it is unsure of, and checking what it can check instead of guessing. The communication style still sets the tone and the work style still sets how much Pine drives.
- **Your wellbeing comes first**: When you show signs of a genuine crisis, Pine says so directly and points you to crisis resources (local ones when it knows your region), setting the task aside until you want to return to it. It also encourages you to turn to professionals, friends and family rather than relying only on it. This is always on, whatever your settings.

#### Sessions

- **Choose a sub-session's model**: When you ask for it, the agent can start a session with a specific model and thinking level; the new session's model menu shows that model and the "Started a session" marker names it. Otherwise sub-sessions use your default model.
- **The agent can stop a session**: The agent can end another session's current turn the way the Stop button does, leaving the session in the sidebar to be messaged again. Stopping its own sub-sessions needs no approval; stopping any other session asks you first under the approval mode.
- **Asked first after you stop a sub-session**: When you stop a sub-session, the session that started it no longer picks the work back up on its own; it asks whether to resume, change direction, take over or drop it. The conversation shows "You stopped sub-session …".

### Changed

- **Monet only changes the font**: Monet mode in Settings › General is now the "Monet font family" switch in Settings › Appearance. It only switches to the serif reading font and no longer changes how Pine writes, and the communication style is no longer disabled while it is on. If you had Monet mode on, you keep the serif font.
- **Name and pronouns in one field**: Pronouns no longer have their own row; they are a dropdown at the right end of the "Name and pronouns" field. Custom still shows a text field below.
- **Project accent colours as swatches**: New Project and Edit Project show the accent colours as a row of round swatches, named on hover and navigable with the arrow keys; "Pine Default" has a dashed edge because it follows the Appearance setting.
- **Lists as soft filled cards**: Items in Settings › Projects, the remote control devices and WeChat account, and the Memory, MCP servers and Automations dialogs are now softly filled cards instead of outlined ones.
- **`→` also accepts a reply suggestion**: With the caret at the end, `→` accepts the reply suggestion just like `Tab` (the hint still shows only `Tab`). `↑` / `↓` stop at the first and last suggestion instead of wrapping around, and the hint shows only the directions you can still go, changing width smoothly.
- **Opening Pine again brings back its window**: Opening Pine while it is already running brings the existing window forward instead of starting a second Pine.
- **New sessions start replying sooner**: With models that support prompt caching, new sessions in different projects reuse more of what is already cached, so the first reply comes faster and costs less; adding or removing an MCP server no longer invalidates most of the cache.

### Fixed

- Word documents in the workbench Preview card now show on paper (a dark page in dark mode) instead of being transparent over the card's gray background.
- After a run is stopped, tool calls that had not finished no longer stay "running" forever; they show a stop icon and "Stopped" instead of the red failure style, and stay that way when the session is reopened.
- Some dialogs no longer draw a focus ring around their whole content when they open, as if it were selected.
- The thinking timer keeps one decimal for whole seconds under 10 (such as 3 seconds), so the label no longer shifts.
- With a single reply suggestion, the key hint no longer shows a count and then takes it back.

## [0.22.0] - 2026-11-20

> **Highlights**: Live Context (Beta) transcribes a meeting or class on this Mac as context for the conversation, with speaker labels and live translation; Settings › Agent is split into Behavior and Tools, where each family of the agent's tools can be turned off; reply suggestions offer several alternatives at once.

### Added

#### Live Context (Beta)

- **On-device transcription of meetings and classes**: on macOS 26 or later, the workbench has a new Live context card, marked Beta, that transcribes the microphone and/or system audio into text for the current conversation. Only the text is kept; audio is never saved. While it listens it shows the elapsed time and a waveform of the last few seconds, and it can be paused, resumed and stopped. One conversation captures at a time. Not available on Windows yet.
- **Start from the new-session page**: clicking Start in the Live context card on a new session's page creates a conversation in the project the composer shows and starts transcribing into it; messages you send afterwards go to that conversation.
- **Speaker labels**: with Identify speakers on, the transcript marks who is talking as Speaker 1, Speaker 2 and so on. The speaker models ship with the macOS app and run on this Mac, with nothing extra to download. Click a label to rename it or merge it into another speaker, or manage them all under Speakers in the card's "…" menu.
- **Live translation**: with translation on, each finished line gets its translation underneath. The target defaults to the interface language and can be changed in the language menu; the model it uses is chosen in Settings › Models › Live translation model.
- **The agent can read the transcript**: every message you send carries the transcript added since your previous one, and the agent can look further back on its own, so you can simply ask "what are they discussing?". Ask it to "take notes of this class" and it asks for your approval before it starts transcribing; it can then pause, resume or stop on its own.
- **Delete live context**: Delete live context in the card's "…" menu permanently deletes the conversation's transcript, speaker names and translations.

#### Computer Use

- **Browser extension setup guide**: when the agent needs to connect to the browser, Pine shows the extension folder in Finder (File Explorer on Windows) and the agent walks you through turning on Developer mode and using Load unpacked in `chrome://extensions`. The folder stays valid across Pine updates.
- **Sign-ins stay away from the agent**: when the agent hits a sign-in in one of Pine's browser tabs, a small window naming the site asks you for the credentials; what you type goes straight into the page and the agent never sees it.
- **Key presses show the full combination**: Computer Use and webpage key press entries in the conversation show the whole key combination, for example "Pressed a key ⌘ + F".

#### Conversation and composer

- **Several reply suggestions**: reply suggestions now offer up to three alternatives. Press `↑` / `↓` in the empty composer to switch between them, and the key cap shows which one you are on (such as `Tab | 1/3 ↑↓`). Unused suggestions stay with the conversation, even after closing its tab or restarting Pine.
- **Scroll to bottom button**: scrolled well up in a conversation, a Scroll to bottom button appears at the bottom right; clicking it returns to the latest content and keeps following the reply. Live context transcripts have the same button.
- **Send without jumping to the bottom**: `⌥/Alt + Enter` sends a message without moving the conversation, so you can keep reading earlier parts while you send; `Enter` still scrolls to the new message.
- **Optimize prompt for steering messages**: Optimize prompt also works while the agent is working, rewriting a steering message as a short, direct correction instead of a full task brief.
- **More interactive answer components**: interactive answers gain accordions, carousels, popovers on clicked terms, code with a copy button, formulas, timelines, images, a date picker, a countdown timer, forms that flag required fields that are still empty, numbered steps and flip cards, among others, and the agent uses images more often to show screenshots and generated results. In WeChat these components arrive as text, lists and numbered options.

#### Sidebar and tabs

- **Session status in the sidebar**: each session's status shows to the left of its title: a breathing amber dot while it waits for your approval or answer, a small spinner while it runs, and an accent-coloured dot when a run finished while you were not looking (Unread, kept across restarts). This replaces the shield icon at the end of the row.
- **Tabs sized to their titles**: tabs are as wide as their titles, and a title that does not fit fades out at its end instead of ending in "…". The close button appears over the end of the title on hover without pushing it aside. When space runs short, the other tabs shrink to their minimum before the tab bar scrolls.

### Changed

- **Optimize prompt moves to `⌘/Ctrl + Enter`**: `⌥/Alt + Enter` now sends without jumping to the bottom. In a session, Optimize prompt is an outlined button beside Send holding a `⌘↵` key, and its label opens on hover or when reached with `Tab`.
- **Settings › Agent has two groups, Behavior and Tools**: the former Permissions, Context and Tools & privacy groups are folded into them. Tools has a switch for each of Shell commands, Web search, Computer use, Image and video generation, Artifacts and workbench, Live Context, Sessions, Projects, Skills, Automations and MCP servers, all on by default and applied from your next message. The TinyFish key is now set on the Web search row, and Computer Use works only while its Computer use switch is on.
- **Each web page attachment is reviewed**: whenever Computer Use attaches files from this computer to a web page, an approval card lists the files, even after the task's computer control was approved (except in YOLO).
- **Reasoning markers read "Thought for"**: finished reasoning markers in replies read "Thought for …" instead of "Worked for …".
- **The workbench stays closed with no tab open**: closing the last tab closes the workbench, hides its button and makes `⌘/Ctrl + ⌥/Alt + B` do nothing until a tab is open again.
- **A file's Comments card sits above Details**: for files that take comments, the right sidebar shows Comments first and Details below.
- **The agent is choosier about memory**: it saves only what will help later, different conversations and merges it into existing notes instead of adding duplicates. Notes for this project only may keep project-specific decisions and pitfalls; notes for all projects are phrased in general terms.
- **Installers in Pine's style**: the macOS DMG window and the Windows installer's loading screen use Pine's background and icon, and Windows Apps & features shows Pine's icon instead of Electron's.

### Fixed

- In dark mode, the shimmer on running sessions' titles in the sidebar and tabs is visible again.
- PDF previews no longer stutter while you drag the workbench edge or the divider between its cards.
- Showing or hiding a sidebar no longer drops frames during its animation.
- WeChat remote shows costs in `.s`, `.i` and the done notice in the currency chosen in Pine instead of always in US dollars.
- After you send a message, the conversation scrolls to it again instead of staying put with the new message below the visible area.
- On a phone or in a narrow window, the context usage, cost and model name at the bottom of the composer no longer overlap; they collapse one by one, and the hidden details remain in the usage popover and the Model menu.
- Switching from a file tab to another session's tab no longer flashes the workbench open.
- With the native sidebar material, the left sidebar no longer turns black after the window narrows below 768 pixels and widens again.
- Files the agent made were sometimes not submitted as output files, and revised versions were not resubmitted; it now submits them before it finishes and resubmits each finished revision.
- In light mode, the `Tab` key after a reply suggestion is easier to read.
- A row of buttons or badges in an interactive answer no longer runs past the reply and gets cut off in a narrow window or with the workbench open; it wraps instead.
- Hovering a disabled button, such as Send with nothing typed, no longer shows a text cursor.

## [0.21.4] - 2026-11-17

> **Highlights**: the composer shows what the conversation has cost, model pickers show makers' icons, and image and video models get recommendations too.

### Added

- **Conversation cost**: the context usage control at the bottom of the composer now shows the conversation's cost so far (for example `10%  $0.42`) in the currency chosen in Settings › General. Models without pricing show no amount.
- **Model icons**: in the Decisions screening, image generation and video generation model pickers, each model starts with the icon of the company that makes it, and the composer's Model button starts with the current model provider's icon.
- **Recommended image and video models**: the image and video generation model pickers list Pine's recommended models at the top.
- **Asked before a rename**: when you have renamed a session yourself, the agent no longer changes its title directly. It suggests the new title at the end of the conversation, and you can choose Rename, Not now or Don't suggest again.
- **New tab-switching shortcuts**: `⌘/Ctrl + [` and `⌘/Ctrl + ]` switch to the previous and next tab.

### Changed

- **The composer's menus now open with `⌘/Ctrl + R` and `⌘/Ctrl + I`**: `⌘/Ctrl + R` opens the approval mode menu and `⌘/Ctrl + I` the model menu, replacing `⌘/Ctrl + ;` and `⌘/Ctrl + '`. Holding `⌘/Ctrl` slides each shortcut in beside the menu's arrow instead of replacing the arrow.

### Fixed

- Changing a project's accent color or icon no longer ends its running sessions or leaves open tabs showing an empty session.
- Opening the Automations, Skills, MCP servers or Memory window no longer shows a selection ring around its content.
- Dialogs with long content now scroll above their buttons instead of running over them.

## [0.21.3] - 2026-11-17

### Added

- **Keyboard shortcuts for Settings and the composer's menus**: `⌘/Ctrl + ,` opens Settings, `⌘/Ctrl + ;` opens the approval mode menu and `⌘/Ctrl + '` opens the model menu. Hold `⌘/Ctrl` to see these shortcuts beside the controls.

### Changed

- **A reply suggestion is used up once you take it**: after `Tab` fills a suggestion in, clearing the box no longer brings it back. If you typed your own message instead, clearing the box still shows the suggestion.
- **Livelier Optimize prompt button**: in a session, the Optimize prompt button beside Send turns to its colour gradient when you point at it. In a new session, the button's label no longer dims while the optimization runs.

## [0.21.2] - 2026-11-17

### Fixed

- The reply suggestion in the composer now waits for the placeholder to fade out before it appears, disappears as soon as you start typing (including while composing with an input method), and comes back if you clear the box after filling it in with `Tab`.

## [0.21.1] - 2026-11-17

> **Highlights**: Optimize a prompt in one step, get a suggested reply once the agent answers, and manage memories in their own window.

### Added

- **Optimize prompt**: press `⌥/Alt + Enter` in the composer, or click Optimize prompt, and Pine rewrites what you typed into a clearer, more specific prompt; information only you know is left as a `[[…]]` blank, with the first one selected. The rewrite takes into account the project, the conversation's opening and latest turns, attachments and quoted passages. Press `Esc` to cancel while it runs; afterwards, Undo optimization or `⌘/Ctrl + Z` brings back your text. Choose the model it uses in Settings › Models › Prompt optimization model.
- **Reply suggestions**: after the agent answers in a session, a suggested next message fades into the composer; press `Tab` to use it. Turn it off in Settings › Agent › Reply suggestions.
- **Forward messages to other sessions**: the agent can now message any session, with every message reviewed; when a message of yours plainly belongs to another session, it forwards it there and tells you where it went.

### Changed

- **Memories have their own window**: view, edit and delete memories for This project and All projects from More › Memory in the sidebar, even while Remember across sessions is off. The Remember across sessions switch stays in Settings › Agent.
- **Best practices first for general users**: with Technical background set to General user in Settings › User profile, the agent looks up the common practice of a task's field before starting on anything non-trivial.
- **Todos show only the step labels**: the expanded todo list no longer shows a separate description for each task.

### Fixed

- In Settings › Agent, the Interactive answers and Interim answers switches no longer show extra Enabled or Disabled text, matching the other switches.

## [0.21.0] - 2026-11-15

> **Highlights**: Pine remembers across sessions, and every file the agent submits keeps its versions for you to compare and restore.

### Added

#### Memory

- **Pine remembers across sessions**: when you ask Pine to remember something, or it learns your preferences, a decision you made or a trap it fell into, it saves a memory, and new sessions start with those memories. A memory applies either to the current project or to every project, and stays on this device.
- **View and manage memories**: Settings › Agent › Memory lists the memories of the current project and of all projects, where you can edit one, mark whether it is verified, or delete it. Memory can also be turned off there.
- **Memory in the transcript**: saving, reading, changing or deleting a memory shows as its own entry that names the operation and the memory, instead of a raw tool name.

#### Versions of submitted files

- **Every submitted file keeps its versions**: each time the agent submits a file to Artifacts, Pine keeps a copy as it was submitted (files up to 25 MB; each project keeps up to 1 GB, dropping the oldest first). Artifacts shows how many versions a file has.
- **Browse, compare and restore versions in the preview**: the Preview card's header and the footer of a file tab opened from Artifacts have a Version history menu that lists each version with the agent's description of it. A picked version opens read-only, where you can turn on Compare with current, Restore it (the replaced file stays in the history, so it can be undone) or go back to the current file.
- **Compare Markdown as rendered documents**: comparing a Markdown file shows it rendered, with added and removed blocks tinted and changed words marked; turn off Rendered to see the line diff.
- **Save a version as a copy**: while a file tab shows a kept version, Save as… saves a copy of that version wherever you choose.
- **Open a submission from the transcript**: clicking a submitted file in the conversation opens it as it was when submitted.

### Changed

- **Automatic review resists prompt injection**: when web pages, files or tool output contain instructions aimed at the agent, the automatic reviewer no longer lets a high-risk call through on its own, such as sending data to an address you never named; it asks you instead, and denies the call in Autonomous Work.
- **Open with default application moves left**: in a file tab's footer, the button now sits at the left end.

### Fixed

- Selecting text inside a math formula in rendered Markdown and choosing Comment now comments on the whole formula, instead of doing nothing.
- The waiting-for-provider note no longer jumps down a line just as the reply starts.
- Sending a new message no longer expands the previous reply's last tool calls.

## [0.20.1] - 2026-11-14

### Added

- **Use model providers set up in Pi and CC Switch**: turn on Use providers from Pi in Settings › Models › Pi providers (CC Switch), and Pine reads Pi's `models.json` and follows changes to it. These providers and models carry a "Pi" badge in the model picker and are edited in Pi or CC Switch.
- **The update dialog lists every skipped version**: when an update spans several versions, the dialog shows the notes of each one, newest first.

### Changed

- **The waiting-for-provider note appears later**: it shows when about 5 seconds pass after sending without any reply, instead of 3 seconds.

### Fixed

- A session whose run started in another window, before a window reload, or from WeChat now shows as running when opened, and can be stopped.
- Expanding a project again shows five sessions straight away, instead of growing to the earlier count and jumping back.

## [0.20.0] - 2026-11-14

> **Highlights**: send tasks to Pine from WeChat, comment on files right in the preview, let the agent run sub-sessions in parallel, and smoother long conversations.

### Added

#### WeChat remote (experimental)

- **Send tasks to Pine from your own WeChat**: scan the QR code in Settings › Remote control › WeChat and enter the 6-digit pairing code, then message Pine through Tencent's ClawBot. Plain text goes to the current session, and `.help` lists every command (switch sessions and projects, answer questions, approve, fetch files and more). Replies are formatted as Markdown, and interactive answers can be answered with a number.
- **Set limits for WeChat**: choose the default project, the highest and default approval modes, and whether high-risk actions can be approved and files can be sent from WeChat. Sessions started or used from WeChat are marked in the sidebar, key actions raise a system notification, and the tray menu can pause receiving at any time.
- **WeChat on Pine servers**: a headless Pine server can bind and configure WeChat remote from the command line.

#### Comments in file previews

- **Comment in the preview and send it all to a session**: comment on selected text in text, code, Markdown, Word, PDF, slides, e-books and email; on cells in tables; on boxed areas of images, pages and diagrams; and on time spans in audio and video. Comments collect in the Comments card in the right sidebar and go into any session's composer in one step.
- **File details**: a file tab's right sidebar shows the file's type, size, dates and location, plus what the format records, such as a document's author and word count, a photo's camera and date taken, or a recording's codec.
- **Built-in audio and video player**: seek, loop, playback speed, volume, picture in picture and full screen, with keyboard shortcuts (Space to play, `J` / `L` to skip and more).
- **Enlarge images in Markdown**: click an image in the Rendered view to enlarge it, then zoom, pan and step through the document's images.

#### Sessions and the agent

- **Sub-sessions**: the agent can start sub-sessions to work on independent parts in parallel. When one finishes, fails or waits for an approval, its parent is told, reads the result and carries on; sub-sessions sit indented under their parent in the sidebar and can be expanded or collapsed.
- **Let the agent organize sessions and projects**: the agent can search and start sessions, organize session folders, rename or delete sessions, and create, change or delete projects (including their icon and accent color). Deleting a session or changing a project always asks for your approval, in every mode.
- **Drag a session into the composer as an attachment**: drop a session from the sidebar and the agent can read that conversation.
- **Interim answers**: the agent can post a preliminary answer before slow work, or answer each part of a multi-part request as it is solved, while it keeps working. Turn it off in Settings › Agent › Interim answers.
- **Session titles follow the current task**: when a later message starts a different task, the title updates; a title you renamed yourself stays.
- **Sessions waiting for approval in the sidebar**: a session stopped on an approval shows a shield icon at the end of its row.

#### Other

- **Approval cards explain operations plainly**: when the automatic reviewer sends a call to you, the card opens with one sentence on what the operation does and a list of risks, worded for your Technical background setting, with the original parameters under Technical details. Adding or changing an MCP server shows the command it runs on this computer or the address it connects to, and where it applies.
- **Working glow**: while the agent works, a light runs clockwise along the composer's border; turn it off with Settings › Appearance › Working glow.
- **Waiting-for-provider note**: when about 3 seconds pass after sending without any reply, Pine notes it is still waiting for the model provider and suggests checking the network.
- **Pronouns**: choose your pronouns in Settings › User profile; Pine uses them when it refers to you in the third person.
- **Keep the computer awake for remote control**: turn it on in Settings › Remote control so the computer does not sleep while Browser access or WeChat remote is on.
- **Pair by pasting a link**: the Remote Control web page and Home Screen app can pair by pasting a pairing link as well as by scanning.

### Changed

- **Reload the window with `⌘/Ctrl + Shift + R`**: plain `⌘/Ctrl + R` no longer reloads, so a stray press does not lose your place.
- **Smoother long conversations**: replies appear block by block and live thinking scrolls to its newest line; long conversations use noticeably less of the interface while streaming, and rendering pauses while the window is hidden.
- **Clearer review outcomes**: tool call details show each review outcome in bold with its own icon and color, and Pine's own review and denial reasons follow the interface language.
- **Artifacts lists deliverables only**: the workbench's Artifacts lists only the results the agent submitted; files it showed just to report progress no longer appear.
- **Todos card tidies itself**: once every task is completed, the card disappears when the turn ends.
- **Startup screen**: the window shows the Pine logo while it starts and fades in once it is ready.

### Fixed

- Text selections in PDF previews are now visible.
- The conversation no longer jumps when you open the message editor or resend an edited message.
- Sideways trackpad swipes no longer make the conversation bounce, and scrolling inside a wide table, code block or the thinking panel no longer stops it following the newest reply.
- Opening or closing a sidebar keeps the current tab in view, and the tab bar scrolls to a file the agent opens.
- Background sessions such as automation runs no longer show their messages twice when first opened.
- The Remote Control Home Screen app icon is no longer cut off.

## [0.15.8] - 2026-11-07

### Fixed

- Fixed extra blank space, interrupted scroll following, and sudden position jumps when short thinking blocks alternate with tool calls and a reply finishes.

### Updates from 0.15.7 (for users upgrading from earlier versions)

#### Added

- Tool call details show the model that actually reviewed an action, its decision, and failed attempts and fallbacks. These records remain available when reopening a conversation.
- The Remote Control Home Screen app can scan pairing codes with the camera. Pairing dialogs now include guidance on using the system scanner and browser.

#### Changed

- Computer Use now requests permission for the current task. Once approved, ordinary clicks, typing, scrolling, and navigation proceed without individual reviews. Permission expires when the task ends, is stopped, or changes approval mode. System permissions and browser extension installation still require separate approval.
- Interactive answers are enabled by default, with the switch moved to Settings › Agent.
- Clicking the update notice above the workbench checks for the latest version before opening release notes. Pine also checks for updates every two hours.
- New tabs default to the project with the most recent session activity.
- Reduced interface overhead from tabs, presented files, and side-chat highlights while replies stream in long conversations.

#### Fixed

- Remote Control no longer repeatedly switches between paired computers. Opening a session remotely preserves its saved approval mode.
- Swiping horizontally across todo and background-task cards on phones no longer scrolls the transcript at the same time. The workbench overlay no longer shows a width resize handle.
- The new-tab button always adds a tab, preserving existing drafts and previews.
- Fixed layout jumps and scroll positioning when sending messages, receiving queued messages, and collapsing thinking content.
- The quick composer accepts files, pasted images, and long text attachments before opening the main window.
- An unavailable Decisions model no longer prevents switching to another model in settings.
- Tool targets retain their monospace font during automatic review and approval waits.

## [0.15.7] - 2026-11-07

### Added

- Tool call details show the model that actually reviewed an action, its decision, and failed attempts and fallbacks. These records remain available when reopening a conversation.
- The Remote Control Home Screen app can scan pairing codes with the camera. Pairing dialogs now include guidance on using the system scanner and browser.

### Changed

- Computer Use now requests permission for the current task. Once approved, ordinary clicks, typing, scrolling, and navigation proceed without individual reviews. Permission expires when the task ends, is stopped, or changes approval mode. System permissions and browser extension installation still require separate approval.
- Interactive answers are enabled by default, with the switch moved to Settings › Agent.
- Clicking the update notice above the workbench checks for the latest version before opening release notes. Pine also checks for updates every two hours.
- New tabs default to the project with the most recent session activity.
- Reduced interface overhead from tabs, presented files, and side-chat highlights while replies stream in long conversations.

### Fixed

- Remote Control no longer repeatedly switches between paired computers. Opening a session remotely preserves its saved approval mode.
- Swiping horizontally across todo and background-task cards on phones no longer scrolls the transcript at the same time. The workbench overlay no longer shows a width resize handle.
- The new-tab button always adds a tab, preserving existing drafts and previews.
- Fixed layout jumps and scroll positioning when sending messages, receiving queued messages, and collapsing thinking content.
- The quick composer accepts files, pasted images, and long text attachments before opening the main window.
- An unavailable Decisions model no longer prevents switching to another model in settings.
- Tool targets retain their monospace font during automatic review and approval waits.

## [0.15.6] - 2026-11-07

### Added

- Monet mode, in Settings › General.

### Changed

- The reading font now comes with Monet mode instead of its own switch in Appearance.

### Fixed

- A queued message no longer sits tight against the conversation above it; the usual space is back.

## [0.15.5] - 2026-11-06

### Added

- A queued steering message now moves into place: its dashed bubble flies into the conversation and becomes the message that was sent. Ordinary messages rise from the composer the same way.

### Changed

- The Automations, Skills and MCP servers entries moved from the bottom of the sidebar into a More menu that opens to the right, under Projects. While that menu is closed, the number of unread automation runs and approvals stays on More.
- All todos is now a larger version of the card: full task numbers, names and descriptions on the left, with the same dependency graph alongside, and nodes stay aligned when a task name wraps.
- The background process inspector offers Copy path, and its output follows new lines unless you scroll up to read earlier ones.
- Finished background processes leave the card when a turn ends with none still running; the workbench Tasks panel keeps them.
- Resizing the window changes the workbench's width first, keeping the conversation width until the panel reaches its minimum or maximum width.
- Scrollable dialogs use an overlay scrollbar at their outer edge, so the text or graph keeps its width, and headings and action buttons stay outside the scrolling body.
- Scrolling on macOS no longer rubber-bands past the content's edges.

### Fixed

- Status cards no longer stretch to fill the conversation: each keeps its content width, and on a phone the row scrolls horizontally instead of squeezing the cards.
- Long content in the background process inspector now scrolls inside the panel while its title and action buttons stay visible.
- Reasoning markers now cover consecutive reasoning summaries only: empty reasoning adds none, reasoning separated by a reply or tool call gets its own expandable panel, and a panel collapses once output follows it.
- Replies with inline citations no longer repeat the source list below the message, and no longer leave a blank gap there.

## [0.15.4] - 2026-11-05

### Added

- The AI can now find files by name and search file contents within a project. These calls appear in the conversation as "Found files for …" and "Searched code for …", and their details list each matching file, line number and line. Skills can pre-approve these two tools.
- When creating a Skill with Pine, the setup now uses labelled fields and pickers instead of free text.
- Inline citation cards now show the source site's icon.
- The TinyFish web tools setting now shows whether a key is configured.

### Changed

- Long parameter values in tool call details now wrap fully inside their badges.

### Fixed

- File search by name and content no longer fails in the installed app with a "library not found" error.
- Reopening the tab of a new session no longer shows its conversation twice.
- Message bubbles in a side chat are now distinguishable from the card in light mode.
- A follow-up now knows which passage it was asked about.

## [0.15.3] - 2026-11-05

### Added

- The AI can now find files by name and search file contents within a project. These calls appear in the conversation as "Found files for …" and "Searched code for …", and their details list each matching file, line number and line. Skills can pre-approve these two tools.
- When creating a Skill with Pine, the setup now uses labelled fields and pickers instead of free text.
- Inline citation cards now show the source site's icon.
- The TinyFish web tools setting now shows whether a key is configured.

### Changed

- Long parameter values in tool call details now wrap fully inside their badges.

### Fixed

- Reopening the tab of a new session no longer shows its conversation twice.
- Message bubbles in a side chat are now distinguishable from the card in light mode.
- A follow-up now knows which passage it was asked about.

## [0.15.2] - 2026-11-05

### Added

- Select text in a conversation to quote it in the composer. Quotes appear as separate items and can be removed before sending.
- Side chats and follow-ups: ask questions about the current conversation in the workbench, or select a passage to ask a follow-up, without interrupting the main conversation. Side chats can read information but cannot modify files or run commands. Follow-ups are saved and highlighted in the original text; click a highlight to continue, edit a question, or delete the follow-up.
- Web sources in replies now appear as inline citation cards. Hover to see the title and URL, or click to open the source.

### Changed

- The composer smoothly adjusts its height when quotes, files, or configuration-authoring items are added or removed.
- Guidance in approval cards now supports multiple lines: Enter sends, Shift+Enter inserts a line break, and Esc returns to the approval buttons.

### Fixed

- Editing a sent message now preserves the conversation's active tools, avoiding prompt cache invalidation caused by re-enabling default tools.
- Selecting candidates with Chinese or other input methods no longer triggers approval shortcuts or sends guidance prematurely.

## [0.15.1] - 2026-11-04

### Added

- Session cost limit: set a limit before or during a session; reaching it stops the running session and blocks new prompts. The context usage popover is now split into Context and Cost sections, and costs can be shown in a currency chosen in General settings (default follows your system region; USD is shown when exchange rates are unavailable).
- Preview tabs: sessions and files opened casually from the sidebar, search, the file tree or tool markers now replace the untouched preview tab instead of piling up new tabs. Also new: Cmd/Ctrl+Shift+T reopens the last closed tab, Cmd/Ctrl+1–9 jumps to a tab, and middle-click closes a tab.
- On models that cannot take added tools behind the cached prefix, enabling a new tool past 131,072 tokens of context makes the provider reprocess the whole context at full price. Pine now asks first with a card that explains the cost and lets you enable now, compress first and then continue, or stop the run.

### Changed

- Compacting a conversation now reuses the conversation's cached prefix instead of billing the whole context at the uncached rate.
- Automations now open with Cmd+U and MCP servers with Cmd+/; Cmd+L now only focuses the composer.
- In Autonomous Work, the agent must set a wait limit when it asks you a question, and the wait is capped at 20 minutes.

### Fixed

- In Autonomous Work, after five denials in one long run every later approval was denied outright; the reviewer now judges again after one denied batch. A failed review is retried once, and outages no longer count toward consecutive denials.
- A conversation whose title generation failed stayed untitled for good; it is now retried on later turns up to three times, and reasoning models no longer run out of room before producing a title.
- Untitled sessions showed the latest prompt in tabs and the sidebar instead of the first message; sending a later prompt no longer changes the preview.
- Borders of interactive cards in replies are no longer clipped on the outside.

## [0.15.0] - 2026-11-03

### Added

- Automations: Pine can run an agent on its own on a schedule, when a folder changes, or on a system event, a script result or a manual start. Each automation runs inside the permissions you approve on this computer, can use the MCP tools you grant it, and can also be created in No Project. Every run opens as a session under its project in the sidebar, marked with the automation icon and its start time; reply in it to continue as an ordinary conversation. An approval can be declined with a note so the agent revises the automation.
- Skills, automations and MCP servers can be created or managed with Pine: open "Create with Pine" or "Manage with Pine" in their managers and Pine drafts or edits the setup with you in conversation. Saving or enabling an MCP server always asks for your confirmation.
- The agent can look up the current time and time zone, and convert between time zones, instead of guessing.

### Changed

- The Neutral color theme is new and is now the default; if you were on the previous default olive theme, you are switched to Neutral once. Olive remains available as an ordinary choice, and a project can follow the app theme with "Pine Default".

### Fixed

- The error under the browser access switch now explains that the port is already in use, instead of showing a raw system error.

## [0.14.5] - 2026-11-02

### Changed

- When an MCP script calls the same tool in a loop, each call with different arguments is reviewed on its own, and calls started together are reviewed in one request; only an exact repeat reuses an automatic approval, and a call you approve yourself is asked about again each time.
- With the password turned off, "Allow LAN access" now states plainly that turning it on lets any device on the same network control Pine without signing in.
- Over Remote Control, the "Switch computer" button only appears once this device has paired more than one computer.

### Fixed

- Interface preferences such as theme, language and layout are saved again; since 0.14.3, changes were lost on restart.
- Pinch-to-zoom works again in the web interface on Android phones.
- If you had turned on the serif conversation font before 0.14.1, the Reading font option stays on after upgrading.

## [0.14.4] - 2026-11-02

### Fixed

- Fixed Pine 0.14.3, where the agent process exited on startup and no conversation could run.

## [0.14.3] - 2026-11-02

### Added

- Pine can keep running in the menu bar (macOS) or notification area (Windows) after the last window is closed. The tray menu offers Open Pine, a quick composer and Quit, and can be turned off with "Keep running in the background" in Settings. It also switches browser access and Remote Control on or off.
- Queued steering messages now have a "Send now" button: running shell commands move to the background, other in-progress output or tools are interrupted, and the message is delivered right away. The withdraw button also gets a text label.
- Settings let you pick the model used for approvals separately from the model used for titles.
- The headless server can print a pairing link and QR code with `--remote` or `--pair`, and manage paired devices with `remote list|remove`.
- Remote Control pages have a new "Switch computer" entry.
- Running sessions shimmer in tabs and in the sidebar.
- Pine follows the system "increase contrast" preference and forced-colors mode, works better with screen readers, and the code block copy button's label is translated into every interface language.
- Markdown markup is stripped from task-completion notifications, which now show plain text.
- When an MCP script calls the same tool repeatedly in a loop, the approval is granted once instead of being requested on every iteration and eventually falling back to manual confirmation.

### Changed

- The Reading font option now uses serif typefaces (Geist Serif and Noto Serif SC) and no longer applies to the message input box.
- Interface preferences such as theme, language, sidebar and panel layout, and favourite and recent models are now kept in Pine's app data folder instead of web storage, so they are no longer lost when the address Pine runs from changes. Existing preferences are migrated automatically.

### Fixed

- On Windows, the window control buttons are no longer hard to see when Pine's theme is the opposite of the system theme.
- When the Remote Control browser page reconnects after the device was in the background, the conversation output resumes without a full page reload.
- On phones, tapping a help hint now opens it, tool call details open full screen, and double-tapping or focusing an input no longer zooms the page.

## [0.14.2] - 2026-11-02

### Added

- Pine's interface, and the Remote Control pairing page, are now available in Traditional Chinese, Japanese, Spanish, French, German, Korean and Russian. Pick one in Settings.

### Fixed

- After the browser page for Remote Control reconnects, a conversation in progress is no longer shown twice, and the second copy no longer lacks step durations.

## [0.14.1] - 2026-11-01

### Added

- Remote Control: generate a pairing QR code and link in Settings, scan or open it on a phone or another device, approve it on your computer, and use that computer's Pine from the browser without port forwarding. Paired devices can be viewed, renamed and removed in Settings, and the pairing page follows Pine's interface language.
- Settings are regrouped into General, Appearance, Models and Agent, and the language is chosen from a dropdown.
- A new Reading font option (Geist and Noto Sans SC) applies to more text areas and replaces the previous serif option.
- Previews the agent presents open behind the current tab and pulse until you reach them; workbench cards the agent opens pulse too.
- On phone-width windows, shortcut hints appear only after a physical keyboard is used, and the new-session parallax effect is skipped.
- When interface generated by the agent asks you a question, it must now include a submit button, so a picker can no longer leave you with no way to answer.

### Changed

- The sidebar divider fades when native vibrancy is in use.

### Fixed

- Native dialogs such as the quit confirmation and notifications now use the language chosen in Pine instead of the system language.
- Queued steering message bubbles no longer wrap early at 64% width.

## [0.14.0] - 2026-11-01

### Added

- Generate videos through OpenRouter: choose a video model in Settings, then request videos in a conversation. Depending on the model, use first and last frames, image/audio/video references, generated audio, continuation and editing, video upscaling, and model-specific options.
- Video generation jobs retain their progress so you can resume checking and downloading after interrupting a wait or restarting Pine without submitting a new generation request. Conversations show queued, generating, saved, and failed states; generated videos can be saved and previewed in Pine.

## [0.13.1] - 2026-11-01

### Added

- Headless server: Pine can run on a server without a window and be used entirely from a browser. Build it with `bun run build:server`; see `docs/headless-server.md`. It runs on macOS and Linux; on Linux the agent's commands and file tools run in a sandbox that needs bubblewrap, socat and ripgrep, and the server tells you at startup if they are missing or the host blocks the sandbox.

### Fixed

- Pine's browser interface no longer fails to load when opened from another device over a plain `http://` address on your network.
- On macOS, the light-theme sidebar now shows the native sidebar material instead of a solid background.

## [0.13.0] - 2026-11-01

### Added

- Browser access: in Settings → Remote control, you can turn on a local web service and use Pine from a browser on this computer, or from other devices on your network. Browsers sign in with an access password you set and can stay signed in for a chosen time; you can also enter a reverse proxy's public address.
- Pine's browser interface works on phones: large dialogs fill the screen and open one section at a time, open tabs are switched from a menu, and the composer fits the screen width.
- Pine's browser interface can be added to a phone's home screen, where it opens full screen with Pine's icon.
- While Pine is in the background, it can show system notifications for tool approvals and agent questions waiting on you; approval notifications have Approve and Deny buttons on macOS and Windows. On by default, and can be turned off in General settings.
- Quitting Pine while a session or background task is running, or while Remote Control is on, now asks for confirmation first.

### Changed

- On macOS, the native sidebar material is turned on once for everyone in this version, including those who had turned it off; you can turn it off again in Settings.

### Fixed

- Sending a message no longer waits about half a second for the approximate location lookup before the message appears.
- In dark mode, the sidebar with native material no longer looks different from the regular sidebar, and its selection highlight is softer.
- The window buttons no longer shift when switching the native sidebar material on or off.
- The floating composer's glass now keeps its rounded corners as it opens into a window.

## [0.12.1] - 2026-10-31

### Added

- New conversations start with the workspace layout of the previous conversation.
- Right-clicking a file in the presented files list offers preview, open in tab, open, reveal, and copy path; for files in writable project folders, it also offers rename and move to trash.
- A new setting in Preferences lets Pine tell the agent your approximate location (city, region, and country only). It is on by default and can be turned off at any time; the lookup uses DB-IP's free city database that ships with the app and runs on this computer, with nothing extra to download.
- The agent can look up a description of Pine's own interface to answer questions like "where is this feature".
- The sidebar with native glass is now tinted with the project colour.

### Changed

- The floating composer is now on by default.
- The agent reads the system clock to tell the date and time instead of estimating them.
- Editing your profile or adding or removing skills no longer invalidates the prompt cache of an existing conversation, so later replies are faster and cheaper.

### Fixed

- Attachment images in the floating composer did not show in installed builds.
- When the floating composer expands into a new window, the input no longer jumps as attachments change its height.

## [0.12.0] - 2026-10-30

### Added

- Press ⌘; / Ctrl+; in any app to open a floating composer and start a new conversation with Pine. It is off by default; turn it on in Preferences.
- The floating composer can include the app you are working in: its window and the text you have selected there, shown as a chip you can remove. Pine asks for the permission it needs to read them.
- On macOS, the sidebar can use native Liquid Glass on systems that support it.
- Completion notifications can play a sound, in addition to the notification.

### Changed

- The completion signal setting in Preferences is now a menu with Off, Notification, and Notification and sound.

## [0.11.3] - 2026-10-30

### Changed

- The Monet communication style is replaced by a simpler Neutral style, which is now the default; if you used Monet, you are switched to Neutral automatically.

## [0.11.2] - 2026-10-30

### Added

- Press ⌘T / Ctrl+T to open a new tab, as well as ⌘N / Ctrl+N.
- Press ⌘P / Ctrl+P for Project management, ⌘S / Ctrl+S for the skill manager, and ⌘L / Ctrl+L for MCP servers.
- Hold ⌘ (Ctrl on Windows) on its own for a moment to see the shortcuts for search, new session, project management, skills, and MCP servers in the left sidebar.
- The empty tab page shows the Pine logo in a flickering dot grid, and clicking the page sends out a ripple.

### Changed

- When an update is available, the version in the workbench title bar turns into an update notice that opens the release notes; the left sidebar no longer shows the notice.
- For tables that only present data, the agent now uses Markdown tables, and tables in interactive content match the Markdown table style.
- The agent sets up the whole todo list at once and no longer adds one-item lists for work it has already finished.

### Fixed

- The Skills and MCP servers entries are back at the bottom of the left sidebar; in 0.11.0 and 0.11.1 there was no way to open either manager.
- With the Monet communication style, the agent no longer answers only in paragraphs and uses lists, headings, and interactive content where they help.
- Charts in interactive answers no longer replay their animation while the reply is being written.

## [0.11.1] - 2026-10-29

### Added

- Delete a project from Project management in Preferences, or right-click a project in the sidebar to edit or delete it.

### Changed

- With Interactive answers set to Rich, the agent uses visual and interactive content more readily, for example offering choices as buttons or pickers.

### Fixed

- Session search now keeps the match visible in each result and highlights every match in titles and snippets, including short queries such as two-character Chinese words.

## [0.11.0] - 2026-10-29

### Added

- A new workbench beside the conversation replaces the right sidebar. It stacks up to two cards: Artifacts (files the agent presented in this session), Preview, Files, and Background processes. Drag between the cards to share their height, or swap them. Opening or closing the workbench widens or narrows the window at its right edge, so the conversation keeps its width and place. Each session remembers whether its workbench is open, which cards it shows, and the file being previewed.
- Drag the workbench's left edge to trade width with the conversation, or double-click it to restore the default; the width is shared by all sessions and remembered. Press ⌘⌥B / Ctrl+Alt+B to show or hide the workbench.
- The project file tree now lives in the workbench's Files card: click a file to view it in the preview card beside it, or double-click to open it in a tab.
- Files the agent presents open in the workbench preview card by default, so you stay in the conversation; results worth a close look open in a full preview tab instead. For text files the agent can scroll to a line and highlight the relevant ranges.
- The agent can check and arrange the current session's workbench, for example opening the card a task needs and pulsing it to catch your eye. The conversation shows these steps, such as "Showed Todos in the workbench".
- When a previewed file changes on disk, the preview card pulses; in the source view, newly added lines briefly glow blue.
- Todos and background processes now appear as two cards side by side at the end of the conversation. The todo card draws the full dependency graph and keeps the task in progress centred, with a smaller line under it saying what it is doing; each background process opens its details, and a running one can be stopped right from the card.
- The agent can now answer with interactive content you use in place, such as checklists, calculators, forms, tables, and charts; buttons can update the content itself or send its current values as your next message. Under User profile in Preferences, set Interactive answers to Rich, or Simple for text and Markdown only.
- File previews cover far more formats, take Pine's colors in light and dark mode, and gather zoom, paging, search, and fit width into one top bar. New or improved formats include:
  - Tables and data: CSV, TSV, DBF, SQLite, Parquet, and Avro open in a smoothly scrolling data grid that loads large files as you scroll; SQLite lists every table and view.
  - Images and design files: HEIC and multi-page TIFF are supported, images can be rotated, and transparency shows on a checkerboard; Photoshop layers can be shown or hidden one by one; fonts show a specimen, a size ladder, and every glyph, with your own sample text; clicking a swatch in an ASE / ACO palette copies its color.
  - Audio and MIDI: audio plays in a Pine-styled player; MIDI files show as a piano roll colored by track, and any track can be hidden.
  - Archives: browse them in a filterable file tree and preview the chosen file right beside it; encrypted archives ask for their password, comic book archives read page by page, and older archives with GBK file names keep readable names.
  - Email: EML, MSG, and MBOX files show the sender, recipients, date, and body in a mail-reading layout, attachments open in a preview, and you can switch to the raw headers; scripts and remote content in messages are never loaded.
  - Diagrams and mind maps: draw.io, Excalidraw, Mermaid, and XMind files open on a zoomable canvas, with page and sheet switching for draw.io and XMind.
  - Maps and 3D: GeoJSON, KML, KMZ, GPX, and shapefiles draw offline as a map with a list of features and their properties; common 3D models, point clouds, and STEP, IGES, and BREP models open in a 3D viewer that orbits, plays animations, and toggles wireframe, grid, and axes.
  - Engineering drawings: DXF, DWG, DWF, DWFx, and XPS drawings can hide or show layers, switch to monochrome, and export a PNG; GDSII and OASIS layouts and OrCAD / Allegro libraries open too.
  - E-books and documents: EPUB, FictionBook, UMD, and CHM open in a reader with a table of contents and adjustable text size; OFD, Typst (including Chinese text), RTF, HWP, iWork, and WordPerfect documents now preview, and saved web pages, including Safari web archives, open offline.
- Presentations can be played as a slideshow, and spreadsheets switch worksheets from the top bar. In HTML previews a trackpad pinch magnifies the page the way a browser does, and ⌘ + / ⌘ − / ⌘ 0 (Ctrl on Windows) zoom any preview that zooms instead of the whole window.
- A new General setting, Invert documents in dark mode, decides whether PDFs, presentations, and other documents open with inverted pages in dark mode.
- A new General setting, Serif replies, shows assistant replies in a serif font (including a Chinese serif face), while your own messages stay sans-serif.
- The left sidebar now lists sessions from every project, grouped by project, with a New session button for each. Session groups become collapsible folders: move a session in from its context menu or by dragging it onto a folder, and drag it back onto the project to take it out.
- Session search now covers every project, labels each result with its project, and opens the chosen session in that project.
- Press Esc to stop the current session's reply at any time, unless a dialog, a pending approval or question, or message editing is using the key.
- When a new version is found, its update notes open once on their own; the sidebar notice reopens them after you close them.

### Changed

- New profiles start with the Monet communication style; saved profiles keep theirs.
- The Enthusiast technical background is gone, leaving General user and Professional user; profiles that used Enthusiast are treated as General user.
- Showing or hiding the left sidebar now widens or narrows the window, so the conversation keeps its width.
- ⌘N / Ctrl+N now opens a new tab, and ⌘⇧N / Ctrl+Shift+N opens a new window.
- Project management moved below New session in the left sidebar, and the version number moved from the sidebar footer to the workbench title bar.
- Video and audio previews stream straight from the file, so large files start playing quickly; document previews now accept files up to 1 GB.
- In long tasks the agent keeps its todo list more up to date, and always states each task's dependencies, so the todo graph shows how tasks depend on one another.
- When a background command finishes, a reply that is still running learns of it right away and carries on, instead of waiting for the turn to end.
- Switching to YOLO mode mid-session no longer throws away the model's prompt cache, so later replies are faster and use fewer tokens.
- With a lot of session history, Pine starts and refreshes the session list noticeably faster.

### Fixed

- A reply you stopped now shows as Stopped instead of as an error.
- Queued steering messages now show their attachments.
- The tab bar scrolls with the mouse wheel even when the pointer is over the gaps between tabs.
- Dragging a session from a project that is not open onto a tab now attaches it.
- The agent now finds Pine-managed skills where they actually live, instead of guessing a wrong path and failing to open them.
- When the agent needs scratch files it uses the temporary folder the sandbox allows, instead of reaching for /tmp out of habit and asking for privileged-command approval.

## [0.10.2] - 2026-10-09

### Added

- Preferences now offer a third communication style, Monet: a candid dialogue partner that avoids flattery and hype, is specific about uncertainty, and gives its own judgment to help you think more clearly.

## [0.10.1] - 2026-10-07

### Changed

- A newly opened session tab places the cursor in its message input right away.

### Fixed

- Long conversations stay smooth as they grow: the transcript no longer slows down the longer a session gets.
- Open background session tabs no longer slow down the one you are using.
- Scrolling and streaming replies drop fewer frames in long conversations.
- Collapsed thinking blocks and tool-call groups no longer cost rendering time.
- When the right sidebar is closed on launch, the window no longer keeps extra width reserved for it.

## [0.10.0] - 2026-10-05

### Added

- Pine now opens straight into the workspace instead of a project list. A new session picks its project from the project picker beside the send button. No Project keeps work that belongs to no project in Pine's data directory and cannot be renamed, edited, or deleted.
- In a new session, typing @ first in the empty input switches it to a project name with live suggestions (its icon becomes @): use ↑/↓ to move and Enter to choose, and the chosen project moves into the picker beside Send; press Esc, or Backspace in the empty input, to return to the message. No Project's icon is @. New sessions start in the project you chose last, initially No Project.
- Tabs in one window can now come from different projects. Switching tabs moves the sidebars, accent color, and window title to that tab's project, and each open project keeps its sidebar state.
- In any session, the agent can list your projects and, after you confirm, move the session into another project so it continues in that project's folders. When your request clearly belongs to another project, for example because it names that project or its files, the agent offers the move on its own. The conversation shows these steps as "Listed projects" or "Moved to project …".
- Projects can now have an icon: click the icon left of the name in project settings to pick one, and it shows in the project picker and the Projects list in Settings.
- On a session page, press ⌘L / Ctrl+L to jump to the message input at any time.
- Press ⌘⌥← / ⌘⌥→ (Ctrl+Alt+← / → on Windows and Linux) to switch to the previous or next tab, wrapping around at either end.
- Files, folders, or sessions from the sidebar can be dragged onto a session tab at the top to attach them to that session's input and switch to the tab.
- No Project's sidebar opens on Sessions and lists recent sessions from every project, each labelled with its project; clicking one opens it in that project. Session groups are not available in No Project.
- Settings now include Projects: every project in one list, where you can create and edit projects, see how much space Pine uses for each project's sessions, temporary files, attachments, and search cache, and clear temporary files or attachments.
- Preferences now include Signal when work is done (on by default): when a session stops on its own, a desktop notification shows the session title and the final reply, and the Dock icon bounces once on macOS or the taskbar button flashes on Windows. Approval and question requests notify too, and the Dock icon keeps bouncing until you return to Pine.
- Shell commands (bash / privileged_bash) that run longer than 60 seconds no longer keep you waiting: they keep running in the background, the agent immediately gets the task ID and recent output and continues when the command finishes, and you can follow the log or stop it from the right sidebar. Commands with an explicit timeout are still killed when it expires.

### Changed

- For projects with a single folder (including No Project), the Files sidebar lists its files and subfolders directly without an extra root row; projects with additional context folders look as before.
- Deleting a project now happens in the project settings dialog.
- After updating, tabs previously open in each project are not restored; the workspace starts with a new session.
- When your time zone or system language suggests mainland China, the agent notes that default package registries may be slow and asks you once before switching to domestic mirrors, preferring per-command mirror options over editing configuration files.
- The update dialog shows release notes in the interface language.
- The task graph shows the in-progress task as a small spinning loader, and nodes at the graph's edges are no longer clipped.
- After your first message in No Project, the agent now judges whether it is a genuinely global task: if the request depends on something it cannot find, such as "the report", "my notes", or a codebase, it checks your project list first and offers to move the session to a fitting project; requests that lack nothing are simply done in No Project.

### Fixed

- Dropping a folder onto itself or its own subfolder in the Files sidebar no longer shows a "Cannot move…" error; the drop is simply ignored.
- Commands run by the agent no longer hang until a timeout on credential, SSH host key, pager, or confirmation prompts.
- The focus ring on the custom answer field of a question card stays visible.

## [0.8.1] - 2026-10-02

### Added

- Preferences now include a context compaction method: by default the model writes the summary, or you can choose the Semantic algorithm (Beta), which extracts goals, file changes, commits, and brief notes from the conversation without a model call, so compaction is faster and uses no tokens.
- With the semantic algorithm selected, the agent can look up earlier history after compaction; these lookups appear in the conversation with their own icon, showing the query, touched files, or recent entries searched.

### Changed

- The agent's task list is now more selective: it is created only for multi-step, medium-to-high complexity work, split into concrete steps, and kept current as the work progresses, instead of appearing for simple requests or going stale.
- The Decisions-based automatic approval path is now labeled Beta; the model catalog description is shorter, and the execution environment settings are reordered.

### Fixed

- Messages containing only attachments now appear as “[Attachment]” in the conversation outline instead of a blank entry.
- Scrolling with the mouse wheel over a message bubble that has no overflowing content now scrolls the conversation instead of stopping.
- The skill manager dialog no longer stretches when the skill list is long.

## [0.8.0] - 2026-10-02

### Added

- Project workspaces now include a right sidebar for the agent's task list and background commands. Task dependencies appear as a graph; background commands provide live logs, can be stopped, and notify you in the conversation when they finish.
- The agent can maintain a task list that persists across conversations, showing progress and dependencies for multi-step work; click the list to view all tasks grouped by status.
- You can edit a sent message and rewrite the conversation from that point, then continue chatting.
- Project empty states now show previews tailored to the sidebar content, helping you discover workspace features.
- The Pine app version is now shown at the bottom of the sidebar.

### Changed

- The project workspace now uses a layout designed for its sidebars, with a refined tab bar, new-tab button, and right-sidebar spacing.
- Work Skills and MCP Servers moved from the bottom of the left sidebar to the bottom of the right sidebar.

### Fixed

- In dark mode, Markdown table headers, inline code, code blocks, and diagrams now follow the current project color instead of appearing olive green.
- Fixed layout issues with the right sidebar, window resizing, and full-screen changes; the new-project background now matches the active theme.
- Improved message rendering and visibility tracking in long conversations, reducing unnecessary updates while scrolling or switching sessions.
- Fixed several display issues in the task-list empty state, tabs, and background-command details.

## [0.7.2] - 2026-10-01

### Fixed

- Markdown file previews now display local images referenced relative to the document directory; local absolute-path and `file://` images in chat also display correctly.

## [0.7.1] - 2026-10-01

### Fixed

- Markdown code blocks, tables, callouts, diagrams, and tooltips now use consistent colors from Pine’s active theme, including nested content.
- Approval cards and status for MCP tool requests now appear on the parent MCP call and update correctly after a decision.
- Older conversations with context edits can now be opened, searched, and exported while preserving original messages and context edits; they remain resumable after renaming.
- An unreadable conversation file no longer prevents other conversations in the same project from appearing or updating.
- File previews now refresh automatically for project and temporary files, while Markdown and source views keep their scroll position and display mode.

## [0.7.0] - 2026-10-01

### Added

- Automatic approval continues to use model review by default, with an optional Decisions screening path: allow proceeds directly, and needs_user opens a confirmation card. Denied calls or unavailable screening go to the review model, which can approve, deny, or request user confirmation and provide a rationale. Global preferences offer a path switch and an automatically updated catalog of screening models including Jev, Solar Decide, and Span-01.
- Global preferences now let you choose Pine’s default accent from eight themes; new projects and projects without their own accent use that color.

### Changed

- Clicking a read, write, or present-file tool marker now opens the file preview in Pine; historical calls can also reopen presented files that still exist.
- Tool details now match each tool: edits show code diffs and web search results use a table. Status and approval information use a more compact layout, and the dialog width adjusts to its content.
- Decision model screening now more clearly distinguishes authorized development, validation, and diagnosis from actions requiring additional consent, aiming to reduce redundant confirmations caused by sandbox boundaries or exact command wording. Ambiguous screening is directed to model review.
- When automatic approval fails, the manual review card now identifies the fallback and a notification shows the specific error. Long approval content scrolls within the card while decision buttons stay visible.
- The Decisions screening model selector now appears below the image generation model and remains visible but disabled when using model review. Its approval path option is now named “Decision model”.
- The diagnostic logging description in General settings now appears in a help tooltip.
- Session background icons and Markdown links now follow the active accent color. Dollar signs and `(c)` in Markdown prose are preserved instead of being mistaken for math delimiters or automatically replaced.

## [0.6.5] - 2026-09-29

### Added

- Preferences now include optional diagnostic logging to help troubleshoot project communication and sleep or wake issues.

### Changed

- Multiple sessions can now run concurrently; switching or creating a tab no longer interrupts other sessions, and each tab keeps its own conversation, run status, and pending requests.
- Markdown now safely renders structural HTML such as `details` and `summary`, and long inline code in tables wraps at natural break points.

### Fixed

- Fixed the Recommended compaction strategy becoming inactive after session startup or settings updates; models with large context windows now compact automatically above 400K tokens.
- Fixed excess blank space at the end of a conversation while scrolling back through older messages.
- Fixed an issue that could stall the assistant when its process produced a large amount of output.
- Fixed later cards in a sequence of approval requests becoming unresponsive; approval shortcuts now apply only to the active tab.

## [0.6.4] - 2026-09-27

### Fixed

- Fixed an intermittent failure that kept steer messages sent during manual compaction out of the queue; queued messages now continue after compaction completes.

## [0.6.3] - 2026-09-25

### Added

- Projects can now have their own accent color, with eight themes to choose from.
- The Skills manager now discovers global and project Pi skills; local skills can be edited, while package-provided skills are shown as read-only.

### Changed

- Profiles continue to save automatically, without unsaved or automatically saved status messages while editing.

### Fixed

- Messages sent while context is being compacted are now queued and processed after compaction completes.
- Restored the MCP server editor title and corrected the delete button alignment.

## [0.6.1] - 2026-09-25

### Fixed

- Fixed MCP servers failing to run in the packaged app.

## [0.6.0] - 2026-09-25

### Added

- Added MCP server management for project-level or global servers, making external tools available to the AI during sessions.

### Changed

- Model-specific context compaction settings are now preserved when switching models.

### Fixed

- Restored window dragging from the top of the sidebar.

## [0.5.4] - 2026-09-23

### Fixed

- Fixed an issue that prevented sessions from opening in the packaged desktop app.

## [0.5.3] - 2026-09-23

### Added

- Added Autonomous Work mode: AI reviews operations outside the workspace and identifies gaps in the agent's rationale so work can continue without per-call user approval.

### Changed

- After switching permission modes, the assistant receives the current mode's instructions in subsequent conversation, and tools activated on demand are restored with the conversation.
- In Autonomous Work mode, the assistant receives a timeout notice and can continue after the specified wait for a question reply; the mode selector now has a distinct icon and clearer descriptions.

## [0.5.2] - 2026-09-20

### Added

- Image generation now supports text with multiple reference images: use session attachments, local paths, HTTP(S) image URLs, or base64 data URLs, with each request routed according to the selected model's input capabilities.

## [0.5.1] - 2026-09-19

### Fixed

- The installed app no longer misses the newest image models: the model picker now offers the GPT Image 2.5 family and the models released alongside it.

### Changed

- The model picker is smoother: long lists render only the models on screen, scrolling and opening feel more responsive, and an unchanged model list is no longer reloaded.

## [0.5.0] - 2026-09-19

### Added

- Added AI image generation: the always-visible `activate_media_generation` tool enables `generate_image` on demand, so the model can write prompts, set parameters, and save generated images as project files.
- Rebuilt global preferences as a sectioned dialog with a category rail on the left and options on the right, covering the user profile, models and the image model, and the execution environment.

### Changed

- Generated images are no longer opened in a preview automatically; to show one, the model first copies the file into a folder shared with Pine and then calls the presentation tool.
- Image generation always runs on the model the user picked in settings; the model itself cannot name a different image model.
- The new-session parallax now damps vertical travel harder and spreads icon opacity more clearly; the Harness section is localized as 执行环境.
- Pi's model catalogs can now be refreshed ahead of a Pi release while builds stay on the published npm packages, so new models no longer wait for the next Pi version.

### Fixed

- Fixed pure image models on OpenRouter (for example `openai/gpt-image-2.5-flare`) failing with "cannot be used with the chat/completions endpoint"; they now use OpenRouter's dedicated image API.
- Fixed the project start page background animation pegging the CPU near 100% by repainting only the cells that change.
- Fixed the `project-files:preview-presented` error thrown when presenting a file.

## [0.4.8] - 2026-09-18

### Added

- Added the ability to categorize conversations into groups via drag-and-drop.

### Fixed

- Fixed an issue where custom providers and custom models could not be edited or deleted by the user.

### Changed

- Replaced some icons and optimized the visual design.

## [0.4.7] - 2026-09-17

### Fixed

- Preserved follow mode on downward scroll intent.

## [0.4.6] - 2026-09-17

### Changed

- Added session group management.

### Fixed

- Decode percent-encoded Markdown image paths.
- Require explicit intent before stopping thinking follow.

## [0.4.5] - 2026-09-17

### Fixed

- Fixed transcript outline navigation so the first click reaches earlier messages, and keep the popup list aligned with the current user message.

## [0.4.4] - 2026-09-16

### Added

- Visual previews such as images and HTML now support trackpad zoom, with panning for enlarged images.
- The new-session background gains a more balanced icon layout, office-task icon candidates, and a refined entrance with subtle blur.

### Fixed

- Returning to a streaming session now refreshes it to the latest content automatically.
- Closing tabs now preserves horizontal scroll easing and tab movement; empty title-bar areas remain draggable.
- Fixed scroll following and animation during streamed messages, window resizing, and thinking expansion.
- The new-session background icons now disappear immediately when a message is sent.

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
