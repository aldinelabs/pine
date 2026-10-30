# Changelog

All notable changes to Pine are documented in this file.
中文版本见 [CHANGELOG.zh-CN.md](./CHANGELOG.zh-CN.md)。

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Every release section here has a matching section in the Chinese changelog.

## [Unreleased]

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
