# Pine UI Reference

This is the structure of Pine's own desktop interface: what each region does,
what it contains, and how regions relate. Labels are the English UI strings;
the interface is also available in Simplified and Traditional Chinese, Japanese,
Korean, Spanish, French, German and Russian, with translated labels in the same
places. "Mod" means
Cmd on macOS and Ctrl on Windows and Linux.

Use this reference to explain Pine's interface to the user, to tell them where
a control lives, or to plan changes to what they see. It describes the UI; it
does not by itself change anything. Pine operations that act on the UI may be
added to this session later; until then, change the UI only through tools that
are already available (for example the `ui_workbench_*` tools and
`ui_present_file`), and otherwise tell the user where to click.

## Concepts

- Project: a named set of folders the agent may access (one default folder plus
  optional context folders, each read-only or read-write), with its own
  sessions, Skills, MCP servers, icon and accent color. "No Project" holds quick
  work that belongs to no project.
- Session (conversation): one agent conversation inside a project.
- Automation: work Pine does unattended when a schedule, a folder change, a
  system event or a website or feed check calls for it. Each run is a session
  in the project, marked with a workflow icon.
- Manage with Pine: starts a new session whose composer already has Pine's
  authoring tools on for a Skill, an automation or an MCP server.
- Content tab: a session or a file opened in the main content area. The window
  shows the project of the active tab. A session or file opened casually (from
  the sidebar, search, the file tree or a tool marker) opens as the preview
  tab and is replaced by the next casual open; keeping it (for example by
  working in it) makes it an ordinary tab.
- Workbench: the right-hand panel beside the active session.
- Side chat: a read-only conversation about the active session, shown as a
  workbench card. It can read files and search the web but cannot change
  anything. A follow-up is a side chat anchored to a passage of the
  transcript, saved with the session and highlighted in the text.
- Quote: a passage selected in the transcript and attached to the next message
  as a chip in the composer.
- Phone layout: below a phone-sized width (also when Pine is opened on a
  paired device) dialogs fill the screen and show lists and details one at a
  time, the new-session background animation is off, and keyboard shortcut
  hints appear only after a physical keyboard has been used.

## Main window

On macOS, scrolling uses normal inertia and native rubber-banding at the
content's edges. Scrollable dialog bodies use an overlay scrollbar at their
outer edge rather than taking width from the text or graph. Headings and action
buttons stay outside the body scroll area.

```
window
├── title bar
│   ├── leading: [Windows: Pine logo, Pine Settings] · Toggle left sidebar
│   └── trailing: Toggle workbench · [macOS/Linux: Pine Settings]
├── left sidebar                      (Mod+B)
│   ├── top menu: Search sessions · New session · Projects · More
│   │   └── More menu (opens to the right): Automations · Skills · MCP servers
│   ├── session list (all projects)
│   │   └── project group (collapsible)
│   │       ├── session folder (collapsible) → session items
│   │       ├── session items
│   │       └── Show more
│   └── rail (click or drag to toggle)
├── content area
│   ├── tab bar "Open content": tabs · Add session tab · More actions
│   │   · [Switch computer, browser only]
│   └── active tab
│       ├── session tab: transcript · status cards · composer
│       └── file tab: file preview
└── workbench                         (Mod+Alt+B)
    └── up to two cards (top, bottom), each showing one panel
```

### Title bar

- Toggle left sidebar: shows or hides the left sidebar.
- Toggle workbench: shows or hides the workbench; pressed while it is open.
- Pine Settings (gear): opens the Pine Settings dialog.

### Left sidebar

Top menu:

- Search sessions: opens the session search overlay, which searches titles and
  conversation content across every project.
- New session: opens a new session tab.
- Projects: opens Pine Settings › Projects.
- More: opens the managers to the right of the sidebar as a menu of its own;
  picking one closes it and opens that manager. While it is closed, its count of
  unread automation runs plus automation approvals stays on the row.

Session list, one collapsible group per project:

- Project group header: right-click for Edit (opens Edit Project) and Delete
  Project. Its action button creates a session folder in that project.
- Session folder: right-click for Rename folder and Delete folder (its
  conversations move back to the project). Empty folders show "No conversations
  in this folder".
- Session item: click to open it in a tab. A running session's title shimmers
  (with a dot when reduced motion is on). An automation run shows a workflow
  icon and, when idle, the time it started. Right-click for Rename conversation,
  Export conversation (Markdown), Move to folder / Remove from folder, and
  Delete conversation (permanent).
- Show more: reveals older sessions of the project.

More menu:

- Automations: opens the Automations manager. A badge next to it counts unread
  runs plus automation approvals waiting for the user.
- Skills: opens the Skills manager for the active tab's project.
- MCP servers: opens the MCP servers manager for the active tab's project.

### Content area

Tab bar ("Open content"):

- Each tab is a session or a file; each has a close button ("Close {name}").
  Tabs can be dragged to reorder.
- Add session tab: always opens and selects a fresh session tab, keeping
  existing drafts and preview tabs open. Each click adds another tab. Its
  project defaults to the most recent session activity, falling back to the
  last project chosen for a draft when history is not available.
- More actions: for a file tab, Open, Reveal, Copy path, New folder, Rename,
  Refresh and Move to trash; for a session tab, Rename, Export and Delete.
- A running session's tab title shimmers; a tab for an automation run keeps a
  workflow icon until the user replies to it.
- Switch computer: shown only when Pine is opened in a browser through Remote
  Control and at least one computer is paired; returns to the list of
  computers. The workbench header has the same button.
- With no tabs open the area shows "No tabs open" and the shortcut hints.

#### Session tab

From top to bottom:

1. Transcript. Empty sessions show "Imagine what's possible". Otherwise it lists
   messages in order:
   - user messages, with Copy message and Edit message (editing resends);
   - assistant replies, with reasoning markers ("Thinking…", "Worked for …");
     consecutive reasoning summaries share one marker, and empty reasoning
     payloads do not add markers. Reasoning separated by a reply or tool call
     has its own expandable content and live timing. A reasoning panel opens
     while it streams and collapses when output follows that panel, without
     repeating other panels' content or timing. Web sources appear as inline
     citation cards (hover for title and URL, click to open). Source definitions
     are not repeated below the message and do not leave a trailing blank gap;
   - for an automation run, a card at the top with the automation's name,
     trigger and start time; "Instructions" expands what it was asked to do;
   - tool call groups; clicking a call opens Tool call details (status,
     approval, parameters, result). When a call has automatic review records,
     Review history lists each Decisions screening or approval-model attempt,
     its actual model and provider, outcome and reason. It keeps failed attempts
     and handoffs to detailed model review; Approval status shows when the call
     is awaiting user approval or was decided by the user. These records remain
     available when reopening the conversation. Older calls without review
     records do not show a model inferred from current settings. During automatic
     review and approval waits, tool targets keep their monospace styling within
     the shimmering label;
   - file search calls ("Found files for …", "Searched code for …"), which
     show the searched name or text and how many files or lines matched; their
     details list each file, line number and matching line;
   - markers for automation actions, model lookups and MCP configuration
     calls (for example "Ran 3 automation actions");
   - markers for context compaction, errors, stopped responses and background
     process events;
   - interactive answer blocks (checklists, tables, charts, inputs) when
     interactive answers are enabled in Pine Settings › Agent.
     "Load earlier messages" appears at the top of long sessions. The
     Conversation outline lists the user's turns for quick jumping.
     Selecting text in the transcript shows a popover with Quote (adds it to
     the composer) and Follow up (opens a follow-up side chat on the passage).
     Follow up is unavailable while a reply is running, in a session with no
     message yet, or over text already in a follow-up. Clicking a highlighted
     passage reopens its follow-up.
   - Staged steering messages sit above the status cards. Withdraw and Send
     now sit below each message, aligned to the right, and wrap when needed.
     Their attachments, quotes and text use the same layout as sent messages.
     When the agent consumes one, its complete content moves smoothly into
     the transcript and blends into the sent message without stretching text
     or attachments, or delaying the response. Ordinary sent messages rise
     together with their attachments and quotes from the composer. The
     conversation scrolls smoothly to each new turn while the message arrives.
     Once a turn is positioned, folding thinking or tool details above it
     keeps its position steady.
     When thinking folds as an answer begins, the view holds steady and the
     answer fills the room it leaves before following new text again.
     Alternating short thinking and tool runs follows their actual height
     without reserving extra blank space. The last tool runs still fold with
     smooth scroll following as a reply finishes.
     Scrolling up releases unused space below a newly positioned turn; a quick
     downward scroll cannot return to that discarded blank area or snap the
     conversation back to the bottom.
     With reduced motion enabled, messages and scroll positions appear at once.
2. Status cards above the composer, shown when relevant. The row sizes itself
   to its content, up to the available width; a lone card is not stretched to
   fill the conversation. When both cards compete for room, space is reserved
   for each and long labels truncate rather than crowding out the other card.
   On a phone the cards keep their content width and the row scrolls
   horizontally when together they exceed the width. Swiping across the row
   keeps the cards in place; vertical gestures scroll the transcript. The
   row leaves room around the card edges so their outlines stay visible.
   - Todos: progress of the agent's task list; opens All todos. The dialog is
     a larger version of the card: full task numbers, names and descriptions
     on the left, with the same dependency graph on the right. Wrapped rows
     keep their graph nodes aligned. The heading stays visible while the list
     scrolls internally; deleted tasks are omitted.
   - Background processes: running and finished processes started by the
     agent. Finished entries fade from this card when a turn ends with no
     processes still running; the workbench Tasks panel keeps the session's
     retained entries. A process opens an inspector with command, output, Copy path and,
     while running, Stop. Long details scroll inside the inspector while its
     title and action buttons stay visible. Output scrolls separately and
     follows new lines unless you scroll up to read earlier output.
3. Composer ("Session message"):
   - Approval required card, when a tool call needs the user: Approve, Reject,
     Reject with guidance (multi-line: Enter sends, Shift+Enter adds a line,
     Esc returns to the buttons). When enabling a new tool would make the
     provider reprocess a very long context at full price, the card offers
     Activate now, Compress, then continue, or stopping the run.
   - Automation approval card, in place of the composer, when the agent asks to
     create, change, turn on or delete an automation: it lists the triggers,
     what the automation reads, writes and can reach, and warnings; Approve
     (or Turn on / Delete), Reject, or Reject with guidance.
   - Questionnaire card, when the agent asks questions: Previous, Next, Cancel,
     Submit, plus a free-text answer.
   - Chip ("Creating a skill / an automation / an MCP server
     with Pine"), on a draft started from Manage with Pine; its remove button
     turns the draft into an ordinary conversation.
   - Attachment list (files, folders, conversations, pasted text and images),
     a chip for selected content sent from a preview, and "Quoted passages"
     chips, each with Remove quote. The composer resizes smoothly as these
     appear and disappear.
   - Text box. In a new session with no project, typing `@` chooses the
     project.
   - Add attachment menu: File, Folder, Conversation. Files can also be
     dropped or pasted.
   - Footer controls: project target ("Send to {name}"), Model, Reasoning
     effort, approval mode, Context usage, and the action button.
   - Approval modes: Let Me Review (ask before risky actions), Auto Approve
     (balance autonomy and control), Autonomous Work (maximize autonomy
     without user action), YOLO (no permission constraints; asks the user to
     confirm before enabling). The choice is saved with the conversation
     and shared between desktop and remote devices.
   - Sessions the agent starts: when asked, the agent can start a separate
     session that works in the background in this or another project. It
     appears in the left sidebar without opening a tab or changing the active
     session; open it from there. Its approval mode is the asking session's
     or a stricter one, never a looser one. In Let Me Review, starting it
     shows an Approval required card with its first message. The agent can
     also search the user's sessions in every project.
   - Computer Use: the first control action requests permission to control
     desktop apps and browser tabs for the current task. Let Me Review shows
     one Approval required card; Auto Approve and Autonomous Work review the
     task grant automatically. Ordinary clicks, typing, scrolling, app switching,
     and navigation then continue without per-action reviews. The grant ends
     when the run finishes, Stop response is used, or the approval mode changes;
     it is not restored when reopening a session. OS permission requests and
     browser extension installation are approved separately. The agent is
     instructed to ask before consequential actions not already authorized,
     such as payments, sending, publishing, irreversible deletion, security
     changes, or sharing sensitive information with a new recipient. This
     depends on the agent's judgment, not an independent check on each click.
   - Context usage: a popover with a Context section (tokens used, context
     window, utilization, cache hit rate, Compact context now) and a Cost
     section (conversation cost, in the currency chosen in Pine Settings ›
     General) with a Session cost limit switch and amount. Reaching the limit
     stops the running session and blocks new prompts until the limit is raised
     or cleared; it can be set before a session starts.
   - Action button: Send message when idle; Steer response (adds the message
     to the running turn) or Stop response while the agent works.

#### File tab

A preview of one file, with controls that depend on the format: Rendered or
Text view, page navigation, search, zoom, fit width, rotate, invert colors,
play and pause for media, sheet and layer pickers, and Open with default
application. "Send to tab…" or "Send selection to tab…" attaches the file or
the selected content to a session tab, or creates a session for it.

### Workbench

A resizable panel on the right of the window, kept per session. When it is open,
resizing the window changes this panel's width first, keeping the conversation
width until the panel reaches its minimum or maximum width. Resizing back
restores the previous proportions. Its leading edge can still be dragged to
trade width with the conversation. On narrow screens it opens as an overlay
without the width resize handle. It holds one or two cards stacked top and
bottom, with a handle to resize them. Each card header
has a panel switcher and buttons to open the content in a tab, add a card and
close the card. The panels are:

- Artifacts: files the agent presented in this session; Preview in workbench.
- Background processes: processes started by the agent, with their output.
- Preview: the file last presented or picked from Artifacts; Open in tab.
- Files: the project's file tree, with its folders and access levels.
- Side chat: opened by the user only (panel switcher, Add card, or Follow up
  in the transcript); the agent's `ui_workbench_*` tools cannot open it. A
  card for the whole conversation shows "Not saved" and is discarded when
  closed or when its tab closes (both ask first); a follow-up card shows
  "Follow-up", is saved with the session, and has Delete follow-up (asks
  first). Questions can be edited and resent. It needs a session with at least
  one message.

The footer shows Pine's version.

When the agent opens a card, or presents a file in the Preview card, that
card pulses in yellow until the user hovers or focuses it. A file the agent
presents fullscreen opens as a tab behind the active one, never taking
focus, and the tab pulses the same way until the user opens it. Cards or tabs
the user opens themselves do not pulse.

## Dialogs and overlays

- Pine Settings, with sections (a phone shows the section list first):
  - General: language (dropdown), currency (follows the system region by
    default; used for cost and cost limits at the European Central Bank's daily
    rate, US dollars when rates are unavailable), the Monet mode switch (the
    last item of the Interface group: Sóber's voice plus a serif reading font
    for assistant replies, session titles, headings, input placeholders and the
    model picker; it replaces the communication style in the user profile,
    which is disabled while it is on, and your own messages, buttons, menus and
    the sidebar keep the interface font), completion signal, attention
    notifications, quick composer shortcut, keep running in the background
    (macOS and Windows desktop app), diagnostic logging.
  - Appearance: color mode (System, Light, Dark), Pine default color theme
    (Neutral unless changed; the palettes are Neutral, Olive, Red, Rose,
    Orange, Green, Blue, Yellow, Violet), sidebar blur (macOS), inverted
    documents in dark mode.
  - Models: model catalog refresh, title generation model, approval model,
    image generation model, video generation model, Decisions model.
  - Agent: Interactive answers switch (Enabled or Disabled; enabled by default),
    automatic approval path, context compaction strategy and method,
    TinyFish web tools key (shows Configured or Not configured), approximate
    location.
  - User profile: nickname, communication style (Calm & professional,
    Neutral or Warm & friendly; disabled while Monet mode is on), technical
    background, personal details, custom instructions.
  - Projects: every project with its data usage; New Project, Edit, clear
    temporary files, clear attachments.
  - Remote control (desktop app only): "Remote control via Aldine" pairs
    other devices by QR code or pairing link (no port forwarding, end-to-end
    encrypted) and lists paired devices to rename or remove; it needs Browser
    access turned on. The pairing dialog recommends the system QR scanner
    (usually Camera) and native browser; Chinese text warns against scanners
    in WeChat, Alipay and QQ. Pine Remote's computer list has "Scan pairing
    code", which opens the camera with a Back button and a camera-permission
    error if access fails. Next to it, "Paste pairing link" replaces both buttons
    with a text field, a "Pair" button (or Enter) and Cancel; extra text
    around the link is ignored. Home Screen users scan or paste inside that
    app to save computers there. "Switch computer" returns to this list even with one
    paired computer, so another can be added. Selecting a computer keeps that
    connection until the user switches or it disconnects.
    Browser access serves Pine to a browser behind an access
    password.
- New Project / Edit Project: name, icon, accent color ("Pine Default", which
  follows the Appearance setting, or a palette of its own), default folder,
  additional context folders with access (Read only, Read and write).
- Automations manager, with tabs: Activity (runs with status such as Running,
  Found something, Nothing new, Failed; Refresh, Mark all as read, Show runs
  with nothing new; opening a run opens its session), Automations (each with
  its triggers and permissions, On/Off/Paused state, Run now, Edit
  definition as JSON with Check, Delete) and Secrets (named values such as API
  tokens that automations may use, stored encrypted on this computer and
  changeable only in the desktop app). Manage with Pine starts an automation
  draft. Automations run only while Pine is open unless keeping Pine running
  in the background is on.
- Skills manager: global and project Skills; create, edit, enable per project,
  delete; Manage with Pine.
- MCP servers manager: servers for this project or all projects; add, edit,
  enable, remove, refresh status; Manage with Pine.
- Session search overlay: search across all projects, open a result.
- Model picker, provider sign-in, custom model and custom provider dialogs,
  opened from the composer's Model control or Pine Settings › Models.
- Update dialog: release notes and installing an update. Clicking the update
  notice above the workbench checks again in place before opening the dialog.
  Pine also checks for updates every two hours. An ongoing download or
  installation keeps its selected version.
- Quit confirmation, when sessions are still running or Remote Control is on.
- Confirmation dialogs for deleting projects, sessions, folders and Skills,
  and for enabling YOLO.

## Quick composer window

A floating composer opened with a global shortcut from any app (set in Pine
Settings › General). It can capture the frontmost app's window and selected
text as context when the user grants the screen and accessibility permissions,
then hands the new conversation to the main window. Files, pasted images and
long pasted text can be attached before the conversation opens in a window.

## Tray and menu bar

With "Keep running in the background" on, closing the last window keeps Pine in
the menu bar (macOS) or notification area (Windows). Its menu has Open Pine,
Quick composer, switches for Browser access and Remote Control via Aldine,
"Manage more settings…" (opens Pine Settings › Remote control) and Quit Pine.
Quitting from the menu is the way to stop automations and Remote Control.

## Keyboard shortcuts

- Mod+N or Mod+T: new tab
- Mod+W: close tab (middle-click a tab also closes it)
- Mod+Shift+T: reopen the last closed tab
- Mod+Shift+N: new window
- Mod+1 … Mod+8: jump to that tab; Mod+9: the last tab
- Mod+Alt+Left / Right: previous / next tab
- Mod+B: toggle left sidebar
- Mod+Alt+B: toggle workbench
- Mod+K: search sessions
- Mod+P: Pine Settings › Projects
- Mod+S: Skills manager
- Mod+U: Automations manager
- Mod+/: MCP servers manager
- Mod+L: focus the composer
