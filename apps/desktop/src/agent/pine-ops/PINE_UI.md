# Pine UI Reference

This is the structure of Pine's own desktop interface: what each region does,
what it contains, and how regions relate. Labels are the English UI strings;
the Chinese interface shows translated labels in the same places. "Mod" means
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
- Content tab: a session or a file opened in the main content area. The window
  shows the project of the active tab.
- Workbench: the right-hand panel beside the active session.
- Phone layout: below a phone-sized width (also when Pine is opened on a
  paired device) dialogs fill the screen and show lists and details one at a
  time, the new-session background animation is off, and keyboard shortcut
  hints appear only after a physical keyboard has been used.

## Main window

```
window
├── title bar
│   ├── leading: [Windows: Pine logo, Pine Settings] · Toggle left sidebar
│   └── trailing: Toggle workbench · [macOS/Linux: Pine Settings]
├── left sidebar                      (Mod+B)
│   ├── top menu: Search sessions · New session · Projects
│   ├── session list (all projects)
│   │   └── project group (collapsible)
│   │       ├── session folder (collapsible) → session items
│   │       ├── session items
│   │       └── Show more
│   ├── footer: Skills · MCP servers
│   └── rail (click or drag to toggle)
├── content area
│   ├── tab bar "Open content": tabs · Add session tab · More actions
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

Session list, one collapsible group per project:

- Project group header: right-click for Edit (opens Edit Project) and Delete
  Project. Its action button creates a session folder in that project.
- Session folder: right-click for Rename folder and Delete folder (its
  conversations move back to the project). Empty folders show "No conversations
  in this folder".
- Session item: click to open it in a tab. Right-click for Rename conversation,
  Export conversation (Markdown), Move to folder / Remove from folder, and
  Delete conversation (permanent).
- Show more: reveals older sessions of the project.

Footer:

- Skills: opens the Skills manager for the active tab's project.
- MCP servers: opens the MCP servers manager for the active tab's project.

### Content area

Tab bar ("Open content"):

- Each tab is a session or a file; each has a close button ("Close {name}").
  Tabs can be dragged to reorder.
- Add session tab: opens a new session tab.
- More actions: for a file tab, Open, Reveal, Copy path, New folder, Rename,
  Refresh and Move to trash; for a session tab, Rename, Export and Delete.
- With no tabs open the area shows "No tabs open" and the shortcut hints.

#### Session tab

From top to bottom:

1. Transcript. Empty sessions show "Imagine what's possible". Otherwise it lists
   messages in order:
   - user messages, with Copy message and Edit message (editing resends);
   - assistant replies, with reasoning markers ("Thinking…", "Worked for …");
   - tool call groups; clicking a call opens Tool call details (status,
     approval, parameters, result);
   - markers for context compaction, errors, stopped responses and background
     process events;
   - interactive answer blocks (checklists, tables, charts, inputs) when rich
     interactive answers are enabled.
     "Load earlier messages" appears at the top of long sessions. The
     Conversation outline lists the user's turns for quick jumping.
2. Status cards above the composer, shown when relevant:
   - Todos: progress of the agent's task list; opens All todos.
   - Background processes: running and finished processes started by the
     agent; opens a process inspector with command, output and Stop.
3. Composer ("Session message"):
   - Approval required card, when a tool call needs the user: Approve, Reject,
     Reject with guidance.
   - Questionnaire card, when the agent asks questions: Previous, Next, Cancel,
     Submit, plus a free-text answer.
   - Staged steering messages, with Withdraw staged message.
   - Attachment list (files, folders, conversations, pasted text and images)
     and a chip for selected content sent from a preview.
   - Text box. In a new session with no project, typing `@` chooses the
     project.
   - Add attachment menu: File, Folder, Conversation. Files can also be
     dropped or pasted.
   - Footer controls: project target ("Send to {name}"), Model, Reasoning
     effort, approval mode, Context usage, and the action button.
   - Approval modes: Let Me Review (ask before risky actions), Auto Approve
     (balance autonomy and control), Autonomous Work (maximize autonomy
     without user action), YOLO (no permission constraints; asks the user to
     confirm before enabling).
   - Context usage: tokens used, context window, utilization, cost, cache hit
     rate, and Compact context now.
   - Action button: Send message when idle; Steer response (adds the message
     to the running turn) or Stop response while the agent works.

#### File tab

A preview of one file, with controls that depend on the format: Rendered or
Text view, page navigation, search, zoom, fit width, rotate, invert colors,
play and pause for media, sheet and layer pickers, and Open with default
application. "Send to tab…" or "Send selection to tab…" attaches the file or
the selected content to a session tab, or creates a session for it.

### Workbench

A resizable panel on the right of the window, kept per session. It holds one or
two cards stacked top and bottom, with a handle to resize them. Each card header
has a panel switcher and buttons to open the content in a tab, add a card and
close the card. The panels are:

- Artifacts: files the agent presented in this session; Preview in workbench.
- Background processes: processes started by the agent, with their output.
- Preview: the file last presented or picked from Artifacts; Open in tab.
- Files: the project's file tree, with its folders and access levels.

The footer shows Pine's version.

When the agent opens a card, or presents a file in the Preview card, that
card pulses in yellow until the user hovers or focuses it. A file the agent
presents fullscreen opens as a tab behind the active one, never taking
focus, and the tab pulses the same way until the user opens it. Cards or tabs
the user opens themselves do not pulse.

## Dialogs and overlays

- Pine Settings, with sections (a phone shows the section list first):
  - General: language (dropdown), completion signal, attention
    notifications, quick composer shortcut, diagnostic logging.
  - Appearance: color mode (System, Light, Dark), default color theme, sidebar
    blur (macOS), reading font (Geist and Noto Sans SC for conversations, the
    composer and session titles), inverted documents in dark mode.
  - Models: model catalog refresh, utility (title generation and review)
    model, image generation model, video generation model, Decisions model.
  - Agent: automatic approval path, context compaction strategy and method,
    TinyFish web tools key, approximate location.
  - User profile: nickname, communication style, technical background,
    interactive answers (Rich or Simple), personal details, custom
    instructions.
  - Projects: every project with its data usage; New Project, Edit, clear
    temporary files, clear attachments.
  - Remote control (desktop app only): "Remote control via Aldine" pairs
    other devices by QR code or pairing link (no port forwarding, end-to-end
    encrypted) and lists paired devices to rename or remove; it needs Browser
    access turned on. Browser access serves Pine to a browser behind an access
    password.
- New Project / Edit Project: name, icon, accent color, default folder,
  additional context folders with access (Read only, Read and write).
- Skills manager: global and project Skills; create, edit, enable per project,
  delete.
- MCP servers manager: servers for this project or all projects; add, edit,
  enable, remove, refresh status.
- Session search overlay: search across all projects, open a result.
- Model picker, provider sign-in, custom model and custom provider dialogs,
  opened from the composer's Model control or Pine Settings › Models.
- Update dialog: release notes and installing an update.
- Quit confirmation, when sessions are still running or Remote Control is on.
- Confirmation dialogs for deleting projects, sessions, folders and Skills,
  and for enabling YOLO.

## Quick composer window

A floating composer opened with a global shortcut from any app (set in Pine
Settings › General). It can capture the frontmost app's window and selected
text as context when the user grants the screen and accessibility permissions,
then hands the new conversation to the main window.

## Keyboard shortcuts

- Mod+N: new tab
- Mod+W: close tab
- Mod+Shift+N: new window
- Mod+B: toggle left sidebar
- Mod+Alt+B: toggle workbench
- Mod+Alt+Left / Right: previous / next tab
