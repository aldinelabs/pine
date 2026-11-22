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
are already available (for example the `ui_workbench_*` tools,
`ui_present_file`, `ui_submit_artifact` and `ui_open_guide`, which opens one
of the Guides below at a chosen step), and otherwise tell the user where to
click.

## Concepts

- Project: a named set of folders the agent may access (one default folder plus
  optional context folders, each read-only or read-write), with its own
  sessions, Skills, MCP servers, icon and accent color. "No Project" holds quick
  work that belongs to no project.
- Session (conversation): one agent conversation inside a project.
- Sub-session: a session another session started to work for it, like a
  helper. It belongs to its parent and goes only one level deep; when it
  finishes a turn or stops on an approval, Pine tells the parent.
- Automation: work Pine does unattended when a schedule, a folder change, a
  system event or a website or feed check calls for it. Each run is a session
  in the project, marked with a workflow icon.
- Memory: notes Pine keeps across sessions about the user's preferences,
  decisions and what it has learned. Each note is either a project note (seen
  in that project's sessions) or a global note (seen in every project). Later
  sessions start with the list of notes and read a note in full when it is
  relevant. Pine saves a note when asked to remember something or when it
  learns something worth keeping; saving or deleting a note shows as a tool
  call in the conversation. Automation runs neither see nor save notes.
- Manage with Pine: starts a new session whose composer already has Pine's
  authoring tools on for a Skill, an automation or an MCP server.
- Content tab: a session or a file opened in the main content area. The window
  shows the project of the active tab. A session or file opened casually (from
  the sidebar, search, the file tree or a tool marker; a tool marker also
  opens a scratch file in the project's temporary folder) opens as the preview
  tab and is replaced by the next casual open; keeping it (for example by
  working in it) makes it an ordinary tab.
- Workbench: the right-hand panel beside the active session.
- Side chat: a read-only conversation about the active session, shown as a
  workbench card. It can read files and search the web but cannot change
  anything. A follow-up is a side chat anchored to a passage of the
  transcript, saved with the session and highlighted in the text.
- Quote: a passage selected in the transcript and attached to the next message
  as a chip in the composer.
- User: one person's Pine on a computer that several people share (Pine
  Settings › Multiple users). Each user has their own conversations,
  projects, memory, Skills, MCP servers, automations, remote control and
  WeChat bindings, model connections and settings. Users have no passwords;
  they keep things apart, not private. Pine runs as one user at a time, and
  only that user's automations and WeChat remote run. With a single user
  (the default) none of this shows anywhere except that Settings section.
- Guide button: a question-mark icon and a label naming what it explains,
  as the first item of a composer menu or popover above a divider (for
  example "How approval modes work" in the approval mode menu, "How context
  works" in the Context usage popover). It opens an illustrated guide (see Guides under Dialogs and
  overlays). Guide buttons can be hidden everywhere with Guide buttons in
  Pine Settings › General.
- Phone layout: below a phone-sized width (also when Pine is opened on a
  paired device) dialogs fill the screen and show lists and details one at a
  time, the new-session background animation is off, and keyboard shortcut
  hints appear only after a physical keyboard has been used.

## Who's using Pine?

With more than one user, Pine opens on "Who's using Pine?" before anything
else: one round tile per user (their emoji, or the first letter of their name,
on their colour, with the name below; the user who has never been named shows
as "Me") and an "Add user" tile that opens the Add a user dialog (name,
avatar, colour; it does not copy model connections). The user who used Pine
last has focus. Arrow keys move between tiles, Return or Space opens the
focused one, and 1–9 open that user directly. "Remember my choice on this
computer" at the bottom makes Pine open as the last user from then on, without
asking; turning "Ask who's using Pine when it opens" back on in Settings ›
Multiple users brings the question back. Picking a user loads their Pine into
the same window. Pine skips this screen when it restarts to switch users.

## Main window

While Pine starts, the window shows only the Pine logo, gently pulsing, on a
plain background; once the projects, tabs and layout are ready, it fades away
to the full window. With reduced motion turned on, the logo stays still.

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
│   │   └── More menu (opens to the right): Automations · Skills · MCP servers · Memory · Guides
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
  While no tab is open it folds out of the title bar, since the workbench has
  nothing to show then, and comes back when a tab opens.
- Pine Settings (gear): opens the Pine Settings dialog (Mod+,); holding
  Cmd/Ctrl shows the shortcut below the gear.

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
- Session item: click to open it in a tab. The indent to the left of each
  title, under the project icon, shows the session's status (sub-sessions
  too), inside the row's highlight: a breathing amber dot (still when reduced
  motion is on) while the session waits on the user ("Waiting for your approval" or
  "Waiting for your answer"); otherwise a small accent-coloured spinner while
  it runs (a still ring when reduced motion is on); otherwise an
  accent-coloured dot when a run finished while the user was not looking at
  that session ("Unread"). Each state morphs into the next (finishing turns
  the spinner into the dot); opening the session, or returning to its window,
  clears the unread dot, which survives a restart. A running session's title
  also shimmers. An automation run shows a workflow
  icon and, when idle, the time it started. A session started from WeChat
  shows a chat-bubble icon ("From WeChat"); one WeChat later sent a message to
  shows the same icon labelled "Used from WeChat". A session with sub-sessions shows
  a chevron at the end of its row ("Show sub-sessions ({count})" / "Hide
  sub-sessions ({count})") that expands or collapses them (clicking the row of the
  session already open, or the Right and Left arrow keys while the row has
  focus, also do this); sub-sessions are indented
  one level under their parent, joined to it by a tree line, and open like
  any session. Right-click for Rename conversation,
  Export conversation (Markdown), Move to folder / Remove from folder, and
  Delete conversation (permanent). Deleting a session also deletes its
  sub-sessions, and the confirmation says how many ("Sub-sessions deleted with
  it: {count}.").
- Show more: reveals older sessions of the project.

Footer (only with more than one user): the current user's avatar and name.
Clicking it opens a menu headed "Using Pine as {name}" that lists the other
users (picking one restarts Pine as them, asking first if sessions are running
or remote control is on) and "Manage users…" (opens Pine Settings › Multiple
users).

More menu:

- Automations: opens the Automations manager. A badge next to it counts unread
  runs plus automation approvals waiting for the user.
- Skills: opens the Skills manager for the active tab's project.
- MCP servers: opens the MCP servers manager for the active tab's project.
- Memory: opens the Memory manager for the active tab's project.
- Guides: opens the Guides overview (see Guides under Dialogs and
  overlays). It stays in the menu with Guide buttons off.

### Content area

Tab bar ("Open content"):

- Each tab is a session or a file; each has a close button ("Close {name}")
  that appears over the end of the title on hover or keyboard focus, without
  changing the tab's size. Tabs are as wide as their titles within a minimum
  and maximum; the selected tab may be wider than the others. A title that
  does not fit fades out at its end instead of ending in "…".
  Tabs can be dragged to reorder. When space runs short, the other tabs shrink
  to their minimum width first; only then does the bar scroll sideways with
  faded edges, keeping the selected tab in view. Opening or closing a
  sidebar keeps the selected
  tab in its place in the visible strip, fully shown.
- Add session tab: always opens and selects a fresh session tab, keeping
  existing drafts and preview tabs open. Each click adds another tab. Its
  project defaults to the most recent session activity, falling back to the
  last project chosen for a draft when history is not available.
- More actions: for a file tab, Open, Reveal, Copy path, New folder, Rename,
  Refresh and Move to trash; for a session tab, Rename, Export and Delete.
- A running session's tab title shimmers; a tab for an automation run keeps a
  workflow icon until the user replies to it. A sub-session's tab (one another
  session started) shows two speech bubbles instead of the single bubble of
  other session tabs.
- Switch computer: shown only when Pine is opened in a browser through Remote
  Control and at least one computer is paired; returns to the list of
  computers. The workbench header has the same button.
- With no tabs open the area shows "No tabs open" and the shortcut hints
  (new tab, close tab, new window, toggle left sidebar). The workbench closes
  with the last tab and cannot be opened until a tab is open again; the next
  tab brings back its own workbench.

#### Session tab

From top to bottom:

1. Transcript. Empty sessions show "Dare the impossible". Otherwise it lists
   messages in order:
   - user messages, with Copy message and Edit message (editing resends);
   - assistant replies, with reasoning markers ("Thinking…", "Thought for …");
     consecutive reasoning summaries share one marker, and empty reasoning
     payloads do not add markers. Reasoning separated by a reply or tool call
     has its own expandable content and live timing. A reasoning panel opens
     while it streams. While the model is thinking the reasoning streams into
     it as it is written, updated a few times a second, and the panel scrolls
     smoothly to follow the newest line; scrolling up in the panel stops it
     following, and scrolling back to the bottom resumes. With reduced motion
     enabled, the panel jumps instead of scrolling smoothly. It collapses when
     output follows that panel, without repeating other panels' content or
     timing.
     Web sources appear as inline
     citation cards (hover for title and URL, click to open). Source definitions
     are not repeated below the message and do not leave a trailing blank gap;
   - interim answers: when Interim answers is enabled in Pine Settings › Agent
     (the default), the agent may post a preliminary answer before slow work
     such as a web search, or post each part of a multi-part request as soon
     as it is solved, and keep working in the same turn. It appears as
     ordinary reply text, streams in like a reply, and can be selected,
     quoted, searched and exported like one. It is not shown as a tool call
     and never asks for approval; further reasoning, tool calls and the final
     reply follow below it. Sub-sessions and automation runs do not post
     interim answers;
   - for a session started from WeChat or sent a message from WeChat, a small
     "From WeChat" or "Used from WeChat" label above the first message;
   - for an automation run, a card at the top with the automation's name,
     trigger and start time; "Instructions" expands what it was asked to do;
   - tool call groups; clicking a call opens Tool call details (status,
     approval, parameters, result). With Guide buttons on, a call the
     approval model or the sandbox blocked shows "Why was this blocked?"
     beside its approval; it closes the details and opens the approval modes
     step of "Tool calls and approvals" or the sandbox step of "Projects and
     folder access". When a call has automatic review records,
     Review history lists each Decisions screening or approval-model attempt,
     its actual model and provider, outcome and reason. Each outcome is shown in
     bold with its own icon and colour: green "Allowed", amber "Denied", blue
     "User confirmation required", grey "Sent for model review" and red "Review
     failed". Pine's own screening reasons, review failures and denial
     reasons (for example "Auto-review unavailable: …" or "The auto-reviewer
     denied this call.") follow the interface language, also on the approval
     card's Details and the WeChat `.N` view; reasons written by the review
     model and provider error messages are shown as written. It keeps failed
     attempts and handoffs to detailed model review; Approval status shows when the call
     is awaiting user approval or was decided by the user. These records remain
     available when reopening the conversation. Older calls without review
     records do not show a model inferred from current settings. During automatic
     review and approval waits, tool targets keep their monospace styling within
     the shimmering label. A call the user's Stop cut off (still running, or
     not yet started) stops shimmering and shows a stop icon with its label
     followed by "· Stopped" in muted text, not the red failure style; its
     details show the status "Stopped". It stays that way when the
     conversation is reopened;
   - file search calls ("Found files for …", "Searched code for …"), which
     show the searched name or text and how many files or lines matched; their
     details list each file, line number and matching line;
   - Computer Use and webpage key presses ("Pressed a key ⌘ + F"), which
     show the whole key combination with its modifiers: ⌃ ⌥ ⇧ ⌘ in that
     order on macOS, Ctrl / Alt / Shift / Win elsewhere;
   - markers for automation actions, model lookups and MCP configuration
     calls (for example "Ran 3 automation actions");
   - memory calls ("Saved memory release-flow", "Read memory …",
     "Removed memory …", "Listed memories"), which name the note; a folded
     run counts them as "Used memory 2 times";
   - artifact submissions ("Submitted 3 files report.md, data.csv, chart.png",
     or "Submitted 2 of 3 files …" when some were rejected), naming the files
     added to Artifacts by the titles the agent gave them, or else by file
     name. Clicking a submission of one file previews it in the workbench as
     that submission left it: the version it kept, shown with the version bar
     (see Artifact versions), or the file itself when it has not changed
     since or no copy was kept. A submission of several files opens its
     details, which list them under "Submitted files" (title and
     description); clicking one opens it the same way;
   - markers for context compaction, errors, stopped responses and background
     process events;
   - a temporary "Pine is still waiting for the model provider to respond. …"
     note where the reply will appear, when about five seconds pass after a
     message is sent without any reply, reasoning or tool call arriving. Its
     second line suggests checking the network connection and the model
     provider's availability if it stays for tens of seconds. It
     disappears at once when the first content arrives or the run ends, fails or
     is stopped, and is not kept in the conversation;
   - interactive answer blocks when interactive answers are enabled in Pine
     Settings › Agent: layout (cards, grids, tabs, accordions, a horizontally
     scrolling carousel with Previous/Next arrows, popovers that open on
     clicking a dotted-underlined term), text (headings, quotes, highlighted
     code with a copy button, KaTeX formulas, timelines, links, images),
     inputs (buttons, text fields, pickers, sliders, a date picker, a
     countdown timer with Start, Pause and Reset), forms that show a
     message under each field that still needs an answer and only send once
     they are complete, data (tables, bar/line/area/pie/donut/scatter
     charts, numbered steps) and study aids (flashcards that flip when
     clicked, confetti when a goal is reached, none with reduced motion).
     A link in a block asks "Open external link?" before it opens in the
     browser. An image in a block can show a web picture, a file in the
     project's folders or a scratch file the agent saved in the project's
     temporary folder; one that cannot load shows a crossed-out picture
     with the reason (for example the file is outside the project's
     folders) and its path, also shown on hover.
     "Load earlier messages" appears at the top of long sessions. The
     Conversation outline lists the user's turns for quick jumping.
     Selecting text in the transcript shows a popover with Quote (adds it to
     the composer) and Follow up (opens a follow-up side chat on the passage).
     Follow up is unavailable while a reply is running, in a session with no
     message yet, or over text already in a follow-up. Clicking a highlighted
     passage reopens its follow-up.
   - Staged steering messages sit above the status cards. A message sent
     while the agent runs rises from the composer into them and fades in,
     together with its Withdraw and Send now buttons, which sit below each
     message, aligned to the right, and wrap when needed.
     Their attachments, quotes and text use the same layout as sent messages.
     When the agent consumes one, its complete content moves smoothly into
     the transcript and blends into the sent message without stretching text
     or attachments, or delaying the response. Ordinary sent messages rise
     together with their attachments and quotes from the composer. The
     conversation scrolls smoothly to each new turn while the message arrives,
     unless it was sent with Option+Enter (Alt+Enter); a steer sent with
     Enter also scrolls back to the end of the reply.
     Once a turn is positioned, folding thinking or tool details above it
     keeps its position steady.
     When thinking folds as an answer begins, the conversation keeps
     following the end of the reply, with no blank space held below it.
     Scrolling that cannot move the conversation does not stop it following
     the reply: sideways scrolling over a wide table or code block, scrolling
     inside the thinking panel, or scrolling while a new conversation's first
     reply is still too short to scroll.
     Alternating short thinking and tool runs follows their actual height
     without reserving extra blank space. The last tool runs still fold with
     smooth scroll following as a reply finishes.
     Scrolling up releases unused space below a newly positioned turn; a quick
     downward scroll cannot return to that discarded blank area or snap the
     conversation back to the bottom.
     Scrolled well up from the bottom (about a screen's height, at least
     400px), a round "Scroll to bottom" button with a down chevron, the size of
     the composer's Send button, fades in at the bottom right of the
     conversation (bottom left in right-to-left languages), lined up with the
     right edge of the messages, just above the composer; clicking it scrolls smoothly to
     the end and keeps following the reply. It fades out once the reader is
     back within half that distance of the bottom, never appears just
     because a reply grows below, and never shows in an empty session.
     With reduced motion enabled, messages and scroll positions appear at once.
2. Status cards above the composer, shown when relevant. The row sizes itself
   to its content, up to the available width; a lone card is not stretched to
   fill the conversation. When both cards compete for room, space is reserved
   for each and long labels truncate rather than crowding out the other card.
   On a phone the cards keep their content width and the row scrolls
   horizontally when together they exceed the width. Swiping across the row
   keeps the cards in place; vertical gestures scroll the transcript. The
   row leaves room around the card edges so their outlines stay visible.
   - Todos: progress of the agent's task list; opens All todos. Completed
     tasks leave the card when the next turn starts; once every task is
     completed, the card disappears when the turn ends. The dialog is
     a larger version of the card: full task numbers, names and progress labels
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
   - Approval required card, when a tool call needs the user (starting live
     context shows its settings and Start instead of Approve; see Live
     context under Workbench): Approve, Reject,
     Reject with guidance (multi-line: Enter sends, Shift+Enter adds a line,
     Esc returns to the buttons). When the automatic reviewer (Auto Approve)
     sent the call to you, the card leads with the approval model's
     plain-language account: one sentence on what the operation does and a
     short Risks list. Its wording follows the Technical background setting in
     Preferences (everyday words for a General user, precise terms for a
     Professional user). A small "Explained by the approval model" label
     explains on hover or tap that what actually runs is the original
     parameters. One "Technical details" toggle (collapsed) shows Why Pine
     asked, the Agent's description, the Original parameters and Reviewer
     notes. With the Decisions path Pine waits up to about 10 seconds for the
     account before showing the card (the call shows "Automatic approval in
     progress" meanwhile); if it is not ready in time, the card appears with
     Technical details open and "The approval model is describing this
     operation…" until it arrives, and if none arrives the card shows the
     description and parameters directly. Cards without an account show why
     Pine asked under the title, then the description and parameters;
     Technical details then holds only the Reviewer notes (the sandbox or
     policy evidence and the reviewer's reason) and appears only when there
     are any. Adding, changing, renaming or turning on an MCP server always
     asks, in every mode, with a card that says which server Pine wants to add
     or change, the command it runs on this computer (with the user's
     permissions, outside Pine's sandbox) or the address it connects to, where
     it is available (All projects or This project only) and the names of the
     credentials it receives (values hidden); Technical details holds the
     Server definition. When enabling a new tool would make the provider reprocess a
     very long context at full price, the card offers Activate now, Compress,
     then continue, or stopping the run.
   - Automation approval card, in place of the composer, when the agent asks to
     create, change, turn on or delete an automation: it lists the triggers,
     what the automation reads, writes and can reach, and warnings; Approve
     (or Turn on / Delete), Reject, or Reject with guidance. A request made
     in a session WeChat started or used adds the line "Requested from
     WeChat"; such approvals are still answered only on this computer.
   - Questionnaire card, when the agent asks questions: Previous, Next, Cancel,
     Submit, plus a free-text answer.
   - Chip ("Creating a skill / an automation / an MCP server
     with Pine"), on a draft started from Manage with Pine; its remove button
     turns the draft into an ordinary conversation.
   - Attachment list (files, folders, conversations, pasted text and images),
     a chip for selected content sent from a preview, and "Quoted passages"
     chips, each with Remove quote. Comment chips sent from a file preview's
     Comments card show the file, the comment's location and the comment. The composer
     resizes smoothly as these
     appear and disappear.
   - Text box. Enter sends (Steer response while the agent works) and
     scrolls the conversation to the new message; Option+Enter (Alt+Enter)
     sends without moving the conversation, which keeps following the reply
     only if it was already at the bottom; Shift+Enter starts a new line.
     Send behaves like Enter; its tooltip lists both: "Send message ↵" and
     "Send without scrolling to the bottom ⌥ ↵" (Alt ↵ on Windows and Linux),
     or the Steer response equivalents while the agent works. In a new
     session with no project, typing `@`
     chooses the project.
   - Optimize prompt (or Cmd+Enter / Ctrl+Enter in the text box). In a new
     session it is a sparkles button with its label in a peach-to-blue
     gradient, right of the approval mode; holding Cmd/Ctrl shows the
     shortcut beside it. Once the session has started it sits left of the
     action button (also while the agent works, for a steering message), as
     an outlined pill holding its sparkles icon and a "⌘↵" (Windows and
     Linux: "Ctrl ↵") key, in muted grey like a new session's project
     picker; the pill sits as far from the action button as the action
     button is from the composer's edge. Hovering it or reaching it with Tab blurs the key away in place
     and brings in the label "Optimize prompt" in the gradient as the button
     widens to the left, over the end of the text box without moving
     anything; it
     stays open while optimizing and closes again when the pointer or focus
     leaves. It has no tooltip, since its label names it; in a narrow
     composer (a phone or narrow window) it is just the icon, and only there
     a tooltip names it ("Optimize prompt ⌘ ↵"). Undo optimization rests as
     its icon and opens its label the same way, with a tooltip likewise only
     in a narrow composer. The
     prompt optimization model rewrites what was typed into a clearer, more
     specific prompt, following prompt-writing best practices, and keeps
     the same language. It also reads the project's name and folders, the
     session's opening request and its latest three turns (each request with
     the agent's final reply), and the names of
     attached files and quoted passages, to resolve references such as
     "that file" or "like before" without repeating them. Details only the user can supply are left as `[[…]]`
     blanks; the first one is selected afterwards. The button then becomes
     Undo optimization, which restores the original text, until the text
     box is emptied or sent; Cmd/Ctrl+Z in the text box also brings it back.
     While it works the text box, Send and Add attachment are disabled, the
     button reads "Optimizing…" (the gradient flows through it in a new
     session; it shimmers in a session), and the working light runs along
     the border in the same gradient instead of the accent color, growing in
     and fading out the same way; Esc cancels. It needs typed text. While
     the agent works it rewrites a steering message as a short, direct
     correction to the running turn rather than a full task brief, and Steer
     response waits until it is done. Attachments and quotes are
     kept as they are.
   - Reply suggestion: when the agent finishes answering in a session, the
     prompt optimization model suggests up to three different next messages
     the user might send, most likely first. As soon as the first is
     written, it fades in where the placeholder was (after the placeholder
     fades out), in the same grey, followed by a single key cap; the others
     join as they are written. With one suggestion, including while more
     may still come, the cap reads "Tab", also when a conversation is
     reopened or switched to.
     With several, the cap widens to read "Tab | 2/3 ↑↓", with the shown
     one's number ("Tab | 1 ↓" while more may still come); the count
     slides in and grows smoothly as suggestions arrive. In the empty,
     focused text box, ↑ and ↓ switch to the previous and next suggestion,
     stopping at the first and last (no wrapping around). The cap's ↑ shows
     only when there is a previous suggestion and its ↓ only when there is a
     next one, so the first shows just ↓ and the last just ↑; the cap
     smoothly widens or narrows at its end as an arrow fades in or out. Tab
     (or →, which has no hint) puts the shown suggestion in the text box and
     uses them all up. Any typing, including text an input method is still
     composing, replaces it at once and stops further suggestions from
     arriving; if the text box is emptied without using it, the same
     suggestion comes back at once, without the placeholder showing in
     between, until a new run starts. If generating fails partway, the
     suggestions written so far stay. Unused suggestions are kept with the
     conversation: closing its tab or quitting Pine and reopening it later
     shows them again, at the one that was showing, until the user sends a
     message, uses one with Tab or →, or the conversation changes (a newer
     reply, a rewind or a compaction). They can be turned off with Reply
     suggestions in Pine Settings › Agent.
   - While the agent is working, a thin light runs clockwise along the text
     box's border, in the project's accent color (or, with "Pine Default",
     the Pine default color theme from Appearance settings; grey for
     Neutral), with a soft glow just around it. It grows out from the text
     box's bottom-right corner when the run starts and shrinks and fades away
     when the run ends. It is not shown while an approval or questionnaire
     card takes the text box's place or while the session's tab is in the
     background. With reduced motion turned on in the system, the light stays
     still at the bottom-right corner. It can be turned off with Working glow
     in Appearance settings. The quick composer and side chats don't show it.
   - Add attachment menu: File, Folder, Conversation. Files can also be
     dropped or pasted; a session dragged from the sidebar is attached as a
     conversation. An attached conversation shows as a chip with its title
     ("Untitled conversation" when it has none) and its project's name;
     in a sent message, clicking the chip opens that session in a tab. The
     agent reads an attached conversation with its session tools, without
     asking for approval.
   - Footer controls: project target ("Send to {name}", beside the action
     button in a new session), Model, Reasoning effort, approval mode, the
     Optimize prompt button in a new session or Context usage once the
     session has started, and the action button. Mod+R opens the approval
     mode menu and Mod+I the model menu; holding Cmd/Ctrl slides each
     menu's shortcut in beside its arrow. The Model control starts with the
     selected model's provider icon (e.g. OpenRouter), drawn in a single
     colour that matches the control's text.
   - Narrow composer (a phone, a split or narrow window): the footer
     compacts step by step instead of letting controls overlap. The approval
     mode shows only its icon, then Context usage drops the session cost, the
     Model control drops the reasoning effort ("· High"), Context usage drops
     its percentage (leaving the ring), and at the narrowest the Model control
     shows only the provider icon and arrow. In between, the model name is
     cut short with "…". The hidden details stay in the Context usage
     popover and the Model menu.
   - Approval modes: Let Me Review (ask before risky actions), Auto Approve
     (balance autonomy and control), Autonomous Work (maximize autonomy
     without user action), YOLO (no permission constraints; asks the user to
     confirm before enabling). The choice is saved with the conversation
     and shared between desktop and remote devices. With Guide buttons on
     (General settings), the first item of the approval mode menu, "How
     approval modes work", above a divider, opens the "Tool calls and
     approvals" guide.
   - Model menu: Favorites (or Recently used when there are none), Browse
     all models…, and a Reasoning effort slider when the model offers more
     than one level. With Guide buttons on, it starts with "How models work",
     which opens the "Models and providers" guide, and, when the slider is
     shown, "How reasoning effort works", which opens the "Reasoning effort"
     guide, above a divider.
   - Sessions the agent starts: when asked, the agent can start a separate
     session that works in the background in this or another project. It
     appears in the left sidebar without opening a tab or changing the active
     session; open it from there. Its approval mode is the asking session's
     or a stricter one, never a looser one. In Let Me Review, starting it
     shows an Approval required card with its first message. When the user
     asks for a lighter or a different model, the agent picks the model and
     reasoning effort it runs on from the models the user has set up;
     otherwise it uses the default model. That session's Model
     control shows the choice, the user can change it there like any other,
     and the "Started a session" marker names the model. The agent can also
     search the user's sessions in every project.
   - Sub-sessions: the agent can start the new session as a sub-session of
     the current one (the usual choice) or as a sibling; a sub-session can
     start only siblings, not sub-sessions of its own. The agent can list a
     session's parent, sub-sessions and siblings, read their messages, and
     send them messages. It can also read any other session it found by
     searching, but only after a review, as for other access beyond the
     current work: in Let Me Review an Approval required card ("Read session
     …"), in Auto Approve and Autonomous Work the approval reviewer, in YOLO
     none. It can message those sessions too, reviewed the same way for
     every message ("Message session …"); when a message of yours clearly
     belongs to another session, the agent may forward it there and say
     where it went. The agent can also stop a session's current turn, as
     pressing Stop in it would; pending approvals and questions there end
     unanswered, and the session stays in the sidebar to be messaged again.
     Its own sub-sessions stop without asking; any other session is
     reviewed the same way first ("Stop session …"). The marker reads
     "Stopped session {name}", or "Nothing to stop in session {name}" when
     it was idle. A session cannot stop itself. When a
     sub-session finishes a turn, fails, or waits for an approval, the
     parent's transcript shows a marker ("Sub-session {name} finished",
     "Sub-session {name} failed", "Sub-session {name} is waiting for your
     approval") that opens the sub-session, and the parent's agent reads
     the sub-session's reply and continues, even when the parent has no tab
     open. When the user presses Stop in a sub-session, the parent shows
     "You stopped sub-session {name}" instead, and its agent does not pick
     the work up on its own: it finishes any step it is in the middle of,
     then asks the user what to do next (resume or redirect the
     sub-session, take the work over, or drop it). A sub-session the
     parent's agent stopped itself adds no marker. A message one session sends another, and a
     sub-session's first message, show in the receiving transcript under a
     small "Started by {name}" or "From {name}" line that opens the sending
     session. Approvals of a sub-session are answered in its own tab.
   - Session titles: Pine titles a new session after its first exchange.
     When a later message starts a different task, the agent may update the
     title in the sidebar and tab to the work it is now doing. A title the
     user set with Rename conversation is never replaced silently: the
     agent's new title waits in a card at the end of the transcript, above
     the status cards ("Rename this session to “…”?", noting that the user
     named the session), with Don't suggest again, Not now and Rename.
     Rename applies the title (it then counts as the user's own), Not now
     keeps the current title, and Don't suggest again also stops the agent
     from proposing titles for that session. Renaming the session by hand
     closes an open suggestion.
   - Sessions the agent organizes: when asked, the agent can create, rename
     and delete session folders, move sessions into or out of folders, and
     rename sessions; the left sidebar updates at once. In Let Me Review this
     shows an Approval required card listing the changes. Deleting a session
     always shows an Approval required card, in every mode; a session open
     in a tab stops and its tab closes once it is deleted.
   - Projects the agent manages: when asked, the agent can create a project
     from folders, rename one, add or remove its folders, change its working
     folder, set its icon and accent color (the same choices as Edit Project,
     including "Pine Default"), or delete it. Each change shows an Approval
     required card in every mode, YOLO included; its Details list what will
     change. Deleting a project deletes its sessions but keeps its folders on
     disk; the agent cannot delete the project it runs in, No Project, or a
     project with a session still working. Renaming or changing the folders of
     the agent's own project takes effect when its reply ends and restarts that
     project's sessions, like saving in Edit Project; an icon or accent color
     change applies at once, even alongside a rename (the icon in the sidebar
     and project pickers, the accent color across the window while that
     project is active), and restarts nothing.
   - Computer Use (only while Settings › Agent › Tools › Computer use is on): the
     first control action requests permission to control
     desktop apps and browser tabs for the current task. Let Me Review shows
     one Approval required card; Auto Approve and Autonomous Work review the
     task grant automatically. Ordinary clicks, typing, scrolling, app switching,
     and navigation then continue without per-action reviews. The grant ends
     when the run finishes, Stop response is used, or the approval mode changes;
     it is not restored when reopening a session. OS permission requests,
     browser extension installation, and attaching files from this computer to
     a web page are approved separately; every file attachment shows its own
     Approval required card listing the files, even during an approved task
     (YOLO excepted). When the agent needs a sign-in in a Pine browser tab, a
     small Chrome window naming the site asks the user for the credentials;
     what the user types goes straight into the page and is never shown to the
     agent. A previously registered Pine browser extension is re-pointed at the
     current Pine app automatically when Computer Use starts. The extension is
     not installed by the agent: after its separately approved setup step,
     Pine shows the extension folder in Finder (File Explorer on Windows) and
     the agent tells the user how to load it from `chrome://extensions` with
     Developer mode and Load unpacked. That folder lives in Pine's support
     data (on macOS, `~/Library/Application Support/Pine/computer-use/chrome-extension`),
     so it stays valid across Pine updates. The agent is
     instructed to ask before consequential actions not already authorized,
     such as payments, sending, publishing, irreversible deletion, security
     changes, or sharing sensitive information with a new recipient. This
     depends on the agent's judgment, not an independent check on each click.
   - Context usage: the button shows a ring and the share of the context
     window in use, followed by the conversation's cost so far (e.g.
     "10% | ¥0.63", with the bare currency symbol, "<¥0.01" for tiny amounts)
     once a priced model has
     charged anything; models without pricing show no cost. It opens a
     popover with a Context section (tokens used, context
     window, utilization, cache hit rate, Compact context now) and a Cost
     section (conversation cost, in the currency chosen in Pine Settings ›
     General) with a Session cost limit switch and amount. Reaching the limit
     stops the running session and blocks new prompts until the limit is raised
     or cleared; it can be set before a session starts. The notice that says
     so has "Learn why" (with Guide buttons on), which opens the tokens and
     cost step of "Context and tokens".
     With Guide buttons on, the popover starts with an item above a divider,
     "How context works", which closes it and opens the "Context and tokens"
     guide.
   - Action button: Send message when idle; Steer response (adds the message
     to the running turn) or Stop response while the agent works. The Send
     and Steer tooltips also show Option+Enter (Alt+Enter), which sends
     without scrolling to the bottom; Stop's shows esc.

#### File tab

A preview of one file, with controls that depend on the format: Rendered or
Text view, page navigation, search, zoom, fit width, rotate, invert colors,
media player controls, sheet and layer pickers, and Open with default
application. "Send to tab…" or "Send selection to tab…" attaches the file or
the selected content to a session tab, or creates a session for it.

While a file tab is in front, Pine's right sidebar (the workbench column)
shows cards for that file instead of the session's cards: for project files
that can take comments, Comments on top and Details below, with the same
handle to resize them; other files show Details alone. It is closed by default for each file tab; the
footer's Comments button (Details for files that cannot take comments; with
the number of comments when there are any), the title bar's workbench button
and Mod+Alt+B open and close it, and the X on either card closes it. Each
file tab remembers whether it is open until the tab closes; switching to a
session tab brings back that session's own workbench. While a file tab shows
a kept version (see Artifact versions) it has no cards of its own: the
footer's Comments / Details button is hidden, the sidebar shows the
session's workbench as it was, and the footer's left side reads the file's
type and size instead.

The Details card lists the file's Type, Size (also in bytes), Modified,
Created (where the file system records it) and Location (its path in the
project, or its full path), then what the preview measured — Encoding and
Lines for text, Dimensions, Duration, Pages, Rows and Columns — and what the
format itself records, such as a document's title, author, application and
word count, a photo's camera, date taken, color mode and resolution, a
recording's codec and tags, an email's sender and recipients, or an
archive's entries.
In the Rendered view of a Markdown file, clicking an image (or focusing it
and pressing Enter) enlarges it: the window is blurred and the image moves
from its place in the document to the middle of the window. Its alt text or
file name is shown at the top with a close button (X) at the top right; a
floating toolbar at the bottom has previous and next buttons with the image
number ("2 / 5", only when the document has several images), Fit to window,
Zoom out, the zoom percentage and Zoom in. Mod + scroll also zooms; a
zoomed image can be scrolled around. Clicking outside the image, the close
button or Esc closes it, and the image returns to its place in the document.
Images that failed to load, are still loading or are links do not open.

Audio and video play in Pine's own player: a timeline (click or drag to
seek) above a row with Play/Pause, the current time and length, Comment on
this moment, Loop, Playback speed (a menu of speeds), Mute with a Volume
slider, and for video Picture in picture and Full screen. The player's
keyboard shortcuts work while the preview is the active tab and focus is not
in a text field.

Right-clicking an image or a video opens the system's own context menu. This
works in file previews, in the enlarged Markdown image, and for images in
conversations (Markdown images, agent-built UI images and attachment
thumbnails). For an image: Copy Image, Save Image As…, then Copy File Path
and Show in Finder (Show in File Explorer on Windows, Show in Folder on Linux)
for a local file, or Copy Image Address for a web image. For a video: Save
Video As…, then Copy File Path and Show in Finder, or Copy Video Address. On
macOS a Share submenu below them shares the real file (or the web address)
through the system's share services such as AirDrop, Messages and Mail.
Images Pine decoded itself (such as TIFF and HEIC previews) offer only Copy
Image. Right-clicking text, links or empty space still shows no menu.

##### Comments

In a preview of a project file, comments collect change requests on parts of
the file and send them to a session together. What can be commented depends
on the format:

- Text: text, code, Markdown (Text or Rendered view), HTML, Word and other
  word-processor documents (DOCX, DOC, ODT, RTF, Pages), PDF, slides (PPTX,
  PPT, Keynote), EPUB e-books and email (EML, MSG).
- Cells: spreadsheet workbooks (XLSX, Numbers), CSV/TSV and other data
  tables, and SQLite tables.
- Areas: images, PDF pages, slides, PSD, OFD, Typst, PostScript, draw.io,
  Mermaid and other diagrams, and mind maps (XMind and similar).
- Time spans: audio and video.

How to comment:

- Selecting text shows a small floating menu under the selection with
  Comment. Choosing it, or pressing Mod+Alt+M, replaces the menu with a comment
  box ("Add a comment…") with Cancel and Comment. Enter saves, Shift+Enter
  starts a new line, and Esc cancels. Editing a comment in the panel works the
  same way. A selection that runs onto the next page or slide comments only
  on the part on the first one. In rendered Markdown, a math formula is
  commented on whole: selecting any part of it takes all of it, and the
  comment quotes the formula's TeX source.
- Selecting cells in a table shows the same Comment menu; the comment box
  names the range ("B2:D5", with the sheet name in workbooks).
- In formats with areas, the footer has "Comment on area". It turns the
  pointer into a crosshair with the hint "Drag to box an area. Esc cancels."
  at the top of the preview; dragging a box on an image, page or slide opens
  the comment box for that area.
- In audio and video, "Comment on this moment" in the player comments on the
  current time. To comment on a span, Shift-drag along the timeline, or press
  I at its start and O at its end; the button then reads "Comment on
  0:12–0:30" and Esc clears the marks. Commented spans show as amber bars
  above the timeline; clicking one jumps there and opens its comment.
- Commented passages are highlighted in amber, and commented cells and areas
  are boxed in amber. Clicking one opens the right sidebar at that comment.
- Saving the first comment on a file opens the right sidebar with that
  comment highlighted; later comments are highlighted there without
  reopening it.
- The Comments card (with the number of comments in its header) lists the
  comments in document order. Each shows its
  location — "Line 12" or "Lines 12–18", "Page 3", "Slide 2", a chapter or
  sheet name, cells ("B2:D5"), "Area", or a time span ("0:12–0:30") — a
  "Source view" or "Rendered view" tag when it was made in the other view,
  the quoted text (not for time spans), the comment, and Edit and Delete
  (editing offers Cancel and Save). "Original text changed" marks a comment
  whose passage is no longer in the file after it changed. Clicking a comment
  scrolls to its passage, page, cells, area or time, switching view if
  needed. With no comments the card shows "No comments yet".
- At the bottom of the card, "Send N comments" opens a list of the project's
  session tabs and New session. Choosing one puts the comments into that
  session's composer as comment chips (file, location and comment), opens the
  session, and clears the comments from the preview. Clear all asks "Clear
  all comments?" before removing them.
- A file holds up to 50 comments. Comments last until they are sent or
  cleared; they are not kept when Pine quits.

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

- Artifacts: the session's deliverables, the files the agent submitted as
  results (newest first, each file once, with the agent's title and a one-line
  description when given); Preview in workbench. Files the agent only
  presents (to show progress or comparisons) are not listed. Conversations
  from before this feature list the files the agent presented.
  The agent can file deliverables into folders (nested, such as
  Reports › Week 1); folders are listed before files, newest activity first,
  and only group the list (the files stay where they are on disk). Click a
  folder to collapse or expand it; Pine remembers this per conversation.
  Files without a folder stay at the top level. Folders can't be created,
  renamed or rearranged by hand; ask the agent to refile deliverables.
  Each submission keeps a copy of the file (files up to 25 MB; up to 1 GB
  of copies per project, the oldest removed first); a file with more than
  one kept version shows a clock badge with the number of versions.
  Right-click a submitted file › Version history previews it with the
  Version history menu open (see Preview). Deleting a conversation deletes
  its versions.
  Files can be dragged out of the list: onto Finder, the desktop or another
  app (as the real file), or into the message box or the Files tree (like a
  file dragged from the tree). In the web interface only files inside the
  project folders can be dragged, and only within Pine.
- Background processes: processes started by the agent, with their output.
- Preview: the file last presented by the agent or picked from Artifacts;
  Open in tab. For a submitted file, the header also has Version history (a
  clock button; see Artifact versions below).
- Files: the project's file tree, with its folders and access levels.
- Live context (macOS 26 or later; listed only when available): marked
  with a small grey "BETA" badge beside its name, both in the card title
  and in the panel switcher's menu. It transcribes the microphone and/or
  system audio on this Mac for the active conversation. Audio is never
  saved, only the text.
  The transcript fills the card; the controls sit in a row at the bottom of
  the card, like the composer, and stay there while the transcript scrolls.
  Before a capture the row shows two toggle buttons, Microphone and System
  audio (icons; each turns its source on or off on its own, and the last
  one on stays on), then Identify speakers (a people icon toggle, off by
  default, pressed when on; shown only when this build includes the
  speaker models, which ship with the macOS app; its tooltip says it runs
  on this Mac and labels arrive a few seconds late and can be wrong),
  Translate (a languages icon toggle, off by default and remembered; its
  tooltip says "Translate into {language}", and adds that nothing will be
  translated when the speech is already in that language), a
  language button showing the spoken language as a
  short code such as "EN (US)", "ZH (CN)" or "JA (JP)" (hover for the full
  name), and Start ("Continue" when the conversation already has a
  transcript). When the card is too narrow for its label, Start shows
  only its microphone icon (hover for "Start" or "Continue"); the
  language code is always shown in full. The language button opens a menu listing the languages by
  their full names, such as "Chinese (China)", then "Translate into" with
  the target's short code, a submenu of Pine's interface languages
  (default: the interface language). When the spoken language and the
  target are the same, the menu says nothing will be translated.
  On a new session's page, Start first creates an empty conversation in the
  project the composer shows, opens it in that tab and captures into it;
  messages sent later go to that conversation, which stays in the session
  list even if no message is ever sent. Until its first message, that
  conversation's transcript area is blank: it never shows the new-session
  welcome heading and description, even after reopening it.
  While capturing, the row becomes a bar: a softly pulsing red dot and the
  listening time (paused time not counted), a waveform of the last few
  seconds of sound, the Translate toggle (turns translation on or off for
  the running capture at once), a pause button and a stop button (square
  icon). The
  waveform shows the microphone in the text colour and system audio in
  grey; silence is a flat line. Hovering the time shows the sources and
  the language.
  Paused shows an amber dot, "Paused", a still waveform and a play button
  to resume. "Preparing…" shows while it gets ready. While macOS
  downloads the speech model for the language, the same row shows a small
  progress ring with "Downloading speech model…" and the percent.
  Only one conversation captures at a time; others show "Another
  conversation is capturing live context." with the capturing
  conversation's name, Show (opens it) and Stop, in place of the row.
  Notices appear just above the row: "Microphone access is off" or "System
  audio access is off" with Open System Settings (opens the matching
  Privacy & Security pane); "No system audio yet" with Open
  System Settings while capturing; other problems ("Live context ran into a
  problem", unsupported language, model download failed) with the details;
  and "Speaker labels are off for this capture" (a plain grey notice with
  an amber people icon, "The transcript goes on without them.") when
  speaker labels could not start. Error notices close with the × (Dismiss) at their top right.
  There is also a note when speaker labels run lighter or pause to save
  power or keep up (they recover on their own). Translation problems show
  a plain grey notice with an amber languages icon: "No model to translate
  with" (choose a live translation model in Settings › Models, then turn
  translation on again) or "Translation isn't working right now" (Pine
  keeps trying); transcription goes on either way, and the × dismisses it.
  Before any text the transcript explains what live context does (or says
  "Listening for the first words…" while capturing). Each block starts
  with who spoke and the time; a speaker's consecutive lines stay under
  one label until someone else speaks or two minutes pass. Without speaker
  labels the label is "Me" (microphone) or "Others" (system audio). Words
  still forming are grey with a blinking caret at the end. The card
  follows new text while it is scrolled to the bottom. Scrolled well up
  (a card height, at least 400px), the same round "Scroll to bottom"
  button as the conversation's (a down chevron) fades in at the bottom right
  of the transcript, above the controls; it goes away near the bottom and
  when the transcript is deleted. The transcript's
  top and bottom edges fade wherever more text is hidden past them.
  With Identify speakers, labels are colored "Speaker n" pills (a
  microphone or speaker icon shows the source). Labels appear a few seconds
  late, look faded while they may still change, and are revised once more
  after Stop. Words that have not been analyzed yet carry the neighboring
  speaker's label, faded, instead of "Me" or "Others". "?" means the voice
  is not known yet: a new voice gets its own number once it has spoken for
  several seconds, usually in two separate stretches. Two labels found to be
  one voice later show as one name throughout. "Speaker 1 + Speaker 2"
  marks people talking at once; "· Echo of system audio" with dimmed text
  marks other people's audio picked up by the microphone. Speaker labels
  look clickable (pointer, hover tint, tooltip "Click to rename or merge");
  clicking one opens Rename, "Use “Speaker n”" (once renamed) and Merge into
  (each target shows its microphone or speaker icon). Rename turns the label
  into a small field in place: Enter or clicking away saves, Esc cancels,
  and an empty name goes back to "Speaker n". Names are trimmed and at most
  40 characters; two speakers may share a name (merge them if they are one
  person). A new name shows on every block of that speaker, in every
  window, and stays after Stop and restarts. "Me" and "Others" (shown
  without Identify speakers) stand for the microphone and system audio, not
  people, and cannot be renamed.
  The agent can start live context itself when asked (for example "take
  notes of this class"): an Approval required card appears in every
  approval mode, reading "Pine wants to start live context in this
  conversation.", listing Sources, Language (full name) and Identify
  speakers (On or Off), with a note that it can be paused or stopped from
  the Live context card, and Start in place of Approve. After Start the
  Live context card opens and pulses. The agent can pause, resume and stop
  this conversation's capture without asking, but never another
  conversation's; its calls show as "Started live context", "Paused live
  context", "Resumed live context" or "Stopped live context".
  The conversation's agent sees the transcript: each message the user
  sends carries the lines finalized since the previous message (only the
  most recent part when there is a lot), with the speaker names the card
  shows, and the agent can read earlier or complete ranges
  itself, which shows in the transcript as "Read the live context
  transcript" with an audio-lines icon. Nothing shows in the conversation
  when lines are attached. Other conversations, side chats and
  sub-sessions do not see it; after the transcript is deleted the agent is
  told to disregard it.
  With Translate on, each finished line gets its translation underneath in
  smaller grey text a few seconds later (words still forming are never
  translated); a short grey placeholder bar holds the place while it is
  translating. Turning it on during a capture also translates the last
  few lines said; Stop or turning it off drops what was still waiting.
  Translations are saved with the transcript and show again whenever
  Translate is on with the same target language; a speaker rename or merge
  does not translate again.
  Once the conversation has a transcript, a "…" button (Live context
  actions) sits in the card header beside Add card (in a narrow card the
  title shortens first, so the buttons stay visible), with:
  - Speakers (shown once speakers are labeled): a popover listing every
    speaker with its color and source icon, its name in a field (empty
    shows "Speaker n"; Enter or leaving the field saves, Esc puts it back),
    how many segments it speaks in, and a Merge into button.
  - Delete live context: asks first ("Delete this live context?"): the
    conversation's transcript, speaker names and translations are permanently
    deleted and it can't be undone; while this conversation is capturing,
    the dialog adds "The capture stops first." and Delete stops it before
    deleting.
    The card then shows its setup row again.
- Comments and Details: shown only while a file tab is in front, in place of
  the session's cards (see File tab); they have no panel switcher or Add
  card.
- Side chat: opened by the user only (panel switcher, Add card, or Follow up
  in the transcript); the agent's `ui_workbench_*` tools cannot open it. A
  card for the whole conversation shows "Not saved" and is discarded when
  closed or when its tab closes (both ask first); a follow-up card shows
  "Follow-up", is saved with the session, and has Delete follow-up (asks
  first). Questions can be edited and resent. It needs a session with at least
  one message.

The footer shows Pine's version.

#### Artifact versions

The Version history menu (in the Preview card's header, and in the footer of
a file tab opened from Artifacts or from the Preview card's Open in tab)
lists Current file, then the kept versions newest first, each with its time,
what the agent said about that submission (up to two lines; hover for all of
it), its size and a "Current" badge on the one matching the file on disk. A
copy kept before a restore shows "Before restore". A note says when the file changed since
its last submission or no longer exists. Versions removed to save space, too
large to keep or not kept are listed but cannot be picked.

Picking a version shows that copy read-only in the same preview, with a bar
on top: "Version from …", a Compare with current switch (in the narrow
Preview card it is labelled with a compare icon; turned on, it shows the
changes from that version to the current file in place of the preview, for
text files up to 1 MB; turned off, the preview comes back. A Markdown file's
comparison is rendered: the document as it reads, with added blocks tinted
green, removed ones red, and edited headings, paragraphs and list items as
plain text with the changed words marked; tables, code and formulas that
changed show their old and new form. In a file tab, turning off the footer's
Rendered switch shows the line changes instead), Restore (asks first; only for
files in a read-write project folder) and an X for Back to current file.
Restoring first keeps the current file as a "Before restore" version, so it
can be undone, then shows the file as restored. While a file tab shows a
version, comments and Send to tab are hidden, and Open with default
application gives way to a Save as… button at the footer's right end (asks
where to save a copy of that version; in the browser it downloads the copy).
Picking another file in the Preview card returns it to the current file.

When the agent opens a card, or presents a file in the Preview card, that
card pulses in yellow until the user hovers or focuses it. A file the agent
presents fullscreen opens as a tab behind the active one, never taking
focus; the tab bar scrolls to show it, and the tab pulses the same way until
the user opens it. Cards or tabs
the user opens themselves do not pulse.

## Dialogs and overlays

- Pine Settings, with sections (a phone shows the section list first):
  - General: language (dropdown), currency (follows the system region by
    default; used for cost and cost limits at the European Central Bank's daily
    rate, US dollars when rates are unavailable), Guide buttons (on by
    default; off hides every button and menu item that opens a guide, in
    every open window), completion signal, attention
    notifications, quick composer shortcut, keep running in the background
    (macOS and Windows desktop app), diagnostic logging.
  - Appearance: color mode (System, Light, Dark), Pine default color theme
    (Neutral unless changed; the palettes are Neutral, Olive, Red, Rose,
    Orange, Green, Blue, Yellow, Violet), Working glow (the light running
    along the composer's border while the agent works; on by default,
    applies to every open window), sidebar blur (macOS), Monet font family
    (a switch, off by default: a serif reading font for assistant replies,
    session titles, headings, input placeholders and the model picker; your
    own messages, buttons, menus and the sidebar keep the interface font; it
    changes only how Pine looks, not how it writes), inverted documents in
    dark mode.
  - Models: model catalog refresh; "Pi providers (CC Switch)" (desktop app
    only): a "Use providers from Pi" switch, off by default, that adds the
    providers in Pi's models.json (as set up in Pi or CC Switch), the file's
    path, how many providers were added and which were skipped and why, "Show
    in folder", "Choose folder…" and, after choosing one, "Use default
    folder" (the default is `PI_CODING_AGENT_DIR` or `~/.pi/agent`). Pine only
    reads that file, follows changes to it within a moment, never runs a key
    written as a `!command` (that provider is skipped), and cannot edit, sign
    in to or remove these providers; change them in Pi or CC Switch. Then
    title generation model, approval model, prompt optimization model (used
    by the composer's Optimize prompt; without one it uses the title
    generation model), live translation model (translates live context when
    its translation is on; without one it uses the title generation model),
    image generation model, video generation model, Decisions model.
  - Agent, in two titled groups:
    - Behavior: Interactive answers switch (enabled by default;
      in WeChat an interactive answer arrives as text, lists and tables; its
      buttons, or the options of a block's only picker, are numbered and the
      user answers by replying with the number; other controls work only in
      Pine), Interim answers switch (enabled by default; applies
      from the next message), Reply suggestions switch (suggest the next
      message in the composer after the agent answers; on by default),
      Remember across sessions switch (enabled by default, applies from the
      next message; off, Pine neither reads nor saves memory notes, which stay
      and can still be managed in the Memory manager), Share approximate
      location with AI switch, automatic approval path, context compaction
      strategy and method. With Guide buttons on, the question marks beside
      the approval path and the two compaction settings open a one-page guide
      comparing that setting's options instead of a tooltip; with
      them off, or beside settings without a guide, a question mark shows a
      short description on hover (tap on touch screens).
    - Tools: "Choose what Pine can do. Everything is on by default; a change
      applies from your next message." One row per tool family, each with an
      icon, a one-line description and a switch, all on by default: Shell
      commands, Web search (runs through TinyFish and needs its API key:
      the row's description ends with "Key added." or "Add an API key to
      use it.", and a button before its switch, "Add key" or "Change
      key", opens the key dialog; without a key the web tools stay
      unavailable even while the switch is on), Computer use, Image and video generation, Artifacts and
      workbench, Live Context (off, Pine also stops seeing the live
      transcript), Sessions, Projects, Skills, Automations, MCP servers.
      Off, the agent gets none of that family's tools; open conversations
      pick the change up when their next message starts, never mid-reply,
      and the agent is told which families are off so it can point the user
      back here. Reading and editing files, the to-do list, the clock,
      questions to the user and Pine's own UI reference have no switch.
  - User profile, top to bottom: Aldine methodology (a switch with a Beta
    badge, on by default: Pine talks like a clear-headed dialogue partner,
    candid, specific and light on pleasantries; it shapes how Pine thinks,
    asks and disagrees, while the communication style sets the tone and the
    work style sets how much Pine drives), Name and pronouns (one field: type
    the name Pine should call you, and pick pronouns from the compact
    dropdown at its right end: Not specified, he/him, she/her, they/them or
    Custom; Custom shows a short text field below for your own wording; Not
    specified by default; Pine uses the pronouns when it refers to you in the
    third person), communication style (Calm & professional, Neutral or Warm
    & friendly), technical background, work style (Full takeover, the
    default: Pine drives the task itself and quotes or summarizes the parts
    of a file it discusses, so you can follow its conclusions and changes
    without opening the file beside the chat; Collaborate: Pine assumes you
    have the file open, points to sections, paragraphs or line numbers
    instead of repeating them, keeps you in the loop and asks before key
    decisions; automations always run as Full takeover), personal details,
    custom instructions. Changes save automatically and apply from the next
    message in every conversation.
  - Multiple users (desktop app only): "Add user" opens the Add a user
    dialog (name, avatar from a grid of emoji or the name's initial, colour,
    and "Copy my model connections", on by default, which copies the API
    keys, sign-ins and model choices and nothing else). Each user is a row
    with their avatar and name; the user Pine runs as is marked "Current".
    The pencil button edits a user's name, avatar and colour; the "…" menu
    of every other user has "Switch to this user" and, except for the first
    user Pine ever had, "Delete user" (confirms, then moves that user's
    conversations, projects, memory and model connections to the Trash).
    With more than one user the section also shows "Ask who's using Pine
    when it opens" (on by default; off, Pine opens as whoever used it last)
    and a note that only the current user's automations and WeChat remote
    run. Switching restarts Pine as that user, asking first if sessions are
    running or remote control is on.
  - Projects: every project with its data usage; New Project, Edit, clear
    temporary files, clear attachments.
  - Remote control (desktop app only): at the top, "Keep the computer awake
    while remote control is on" (off by default) keeps the computer from
    sleeping while Browser access is on or WeChat is receiving tasks; the
    display can still turn off and closing the lid still sleeps. While it is
    on and no remote control is on, it notes the computer sleeps as usual.
    Below it, "Remote control via Aldine" pairs other devices by QR code or
    pairing link (no port forwarding, end-to-end encrypted) and lists paired devices to rename or remove; it needs Browser
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
    password. Below it, the "WeChat" group (marked Experimental) lets the
    user send tasks to Pine from their own WeChat through ClawBot. Not
    connected: "Connect WeChat" opens a dialog with a QR code to scan in
    WeChat (a placeholder of the same size holds its place while it loads),
    a countdown, the phase text (scan,
    "Scanned. Confirm on your phone.", a verification-code field when WeChat
    asks for one), and then a pairing step: "In WeChat, send any message (a
    single dot is enough) to the bot. It replies with a 6-digit code. Enter
    it here." with six one-digit boxes (digits only; pasting the code fills
    them all; the code is sent as soon as the sixth digit is entered, or
    with Submit), attempts left and a countdown; "Try
    again" after the code expires. Connected: "WeChat account XXXX-XXXX" with
    a status badge (Online, Connecting, Retrying, Scan again needed, Paused),
    "Scan again" when needed, "Disconnect" (asks first: sessions only WeChat
    holds stop and the WeChat permission settings return to their defaults),
    "Receive tasks from WeChat" (off pauses it; only this computer can turn
    it back on), "Default project" (projects or "No Project"), "Highest
    approval mode" (Let Me Review, Auto Approve, Autonomous Work, YOLO, with
    a warning under YOLO; choosing YOLO asks for confirmation first),
    "Default approval mode" (only modes within the
    highest), "Allow approving high-risk actions from WeChat" (native
    execution outside the sandbox and destructive commands; off by default;
    an approval card from Auto Approve carries the reviewer's one-line
    summary ("Reviewer: …"), and .N also lists its risks),
    "Allow sending files to WeChat" (the session's artifacts, up to 100 MB;
    off by default; when on, up to three files a task submitted or opened
    are also sent right after its result, and the rest stay on `.o`). "Good to know" notes say it works only while Pine runs
    and the computer is awake, messages pass through Tencent's servers, the
    account can read session titles, search results and replies of every project, a proxy may be
    blocked, one WeChat account connects to one computer, in WeChat .help
    (or .?) lists the commands and plain text goes to the current session,
    and tasks that reach Pine more than 10 minutes after they were sent wait
    until they are confirmed in WeChat. Below the notes, the "Run Pine on a
    server" row has a "View docs" button that opens the server guide. If the
    settings could not be read, the
    group says they were reset and WeChat remote is paused. WeChat remote
    always raises a system notification, even with attention notifications
    off, when a session is started from WeChat, an existing session is first
    used from WeChat, a high-risk action is approved from WeChat, a file is
    sent to WeChat, a session is deleted from WeChat, an automation is run
    from WeChat, a session is switched to YOLO from WeChat, WeChat needs a new
    scan, WeChat remote is paused, or its settings were reset. Clicking one
    brings Pine's window forward. The tray menu has a "WeChat remote" switch
    (see Tray and menu bar).
  - About (always last): Pine's icon, "Version X.Y.Z", "By Aldine Labs" and
    a one-line description. "Check for updates" (desktop app only) opens the
    update dialog when a release is available and otherwise says "Pine is up
    to date." (or that the check failed). Links: Documentation (the Chinese
    guide for Chinese interfaces, else English), Source code, Release notes
    and Report an issue open in the browser. License shows "GNU Affero
    General Public License v3.0 or later" with the copyright line; selecting
    it shows the full text. "Open-source software" lists, after a short
    loading placeholder, a search field (name or license), "Adapted and
    bundled projects" (ported code, UI components, fonts, native libraries
    and speech models, each with its license) and "Packages (N)", grouped by
    license into collapsed groups with counts; searching opens every
    matching group. Selecting any entry shows its name, version, license, a
    Homepage link and the full license text on a page inside the section,
    with an "About" back button that returns to the same place in the list;
    a package without a license file says which license its manifest
    declares.
- New Project / Edit Project: name, icon, accent color (a row of round
  swatches, each named on hover: "Pine Default" first, with a dashed edge,
  which follows the Appearance setting, then Neutral, Olive, Red, Rose,
  Orange, Green, Blue, Yellow and Violet; the chosen one has a ring), default
  folder,
  additional context folders with access (Read only, Read and write); the
  question mark beside "Additional context folders" opens the "Projects and
  folder access" guide (with Guide buttons on). Saving
  a new name or folders restarts the project's sessions; a save that changes
  only the icon or accent color applies at once and leaves open sessions and
  their tabs as they are.
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
- Memory manager: the saved notes in two tabs, This project and All
  projects, each note with its name, one-line summary, an Unverified badge
  when Pine has not confirmed it, and an Edit button. Edit opens Edit memory
  with Summary, Details and a Verified switch, plus Delete, which asks first.
  Refresh memories reloads the list. It works whether or not Remember across
  sessions is on (Pine Settings › Agent). Notes are created by Pine, not here.
- Session search overlay: search across all projects, open a result.
- Model picker, provider sign-in, custom model and custom provider dialogs,
  opened from the composer's Model control or Pine Settings › Models.
  Providers and models from Pi's models.json carry a "Pi" badge, their
  provider IDs start with `pi-`, and they have no sign-in or disconnect
  action. The chat model list starts with a "Recommended models" group (those
  models also carry a "Recommended" badge in the session picker); the image
  and video generation model pickers start with their own "Recommended
  models" group when Pine recommends any. Recommendations are fetched online
  and only name models the user can pick.
  Chat model rows start with their provider's icon (e.g. OpenRouter). In the
  decisions, image and video generation model pickers, where every model comes
  from OpenRouter, each row instead starts with the icon of the company that
  makes the model (Google, OpenAI, Black Forest Labs, …), or a generic shield,
  image or video icon when Pine doesn't recognize the maker. The selected
  model's row shows a check mark in its place.
- Guides overview: opened from the sidebar's More menu › Guides. Every
  guide in one list, grouped under Getting started, Working with Pine,
  Extending Pine and Settings explained; each row shows the guide's icon,
  title and one-line summary. Clicking a row opens that guide on top of the
  list; closing the guide returns to the list.
- Guides: one dialog that teaches a feature in plain language, opened from a
  guide button or menu item such as "How approval modes work", or from the
  Guides overview. An animated
  picture fills the top (it holds still with reduced motion); below it a
  small line names the guide and the step ("Tool calls and approvals · Step 1
  of 4"; one-page guides show only the name), then the step's title, a few paragraphs, sometimes a bullet list,
  and a highlighted tip (lightbulb) or caution (amber warning sign). The
  footer has one dot per step (click to jump; none for a one-page guide), Previous (from the second
  step), and Next, which reads Done on the last step and closes the guide.
  Left and Right arrows move between steps. Guides so far: "Tool calls and
  approvals" (what tool calls are, the four approval modes, the approval
  card, good habits), "Context and tokens" (what the context is, tokens
  and cost, compaction, keeping the context lean), "Models and providers"
  (where models come from, connecting a provider, picking a model, good
  habits), "Reasoning effort" (thinking before answering, setting the
  effort, good habits), "Steering and stopping" (steering while Pine works,
  Withdraw and Send now, stopping, what a stop keeps, good habits) and
  "Projects and folder access" (projects as sets of folders, Read only and
  Read and write, the sandbox, good habits),
  "Memory" (asking Pine to remember, project and global notes, the Memory
  manager, Unverified notes, turning memory off),
  "Sub-sessions" (one page: splitting work into sub-sessions, where they
  appear in the sidebar, notices to the parent, limits),
  "Workbench" (the workbench and its panels; Artifacts with folders,
  versions and dragging files out),
  "Work style and Aldine methodology" (one page: work style, communication
  style, technical background, Aldine methodology),
  "Skills" (one page: what a Skill is, how Pine picks one, global and
  project Skills, creating one with Pine),
  "MCP servers" (one page: what MCP servers add, Project and All
  projects servers, adding one with Pine, status),
  "Automations" (what automations are, triggers, creating one with Pine; how
  runs work, Activity, Secrets, running in the background),
  plus three one-page guides opened from settings' question marks:
  "Automatic approval path" (Model
  review versus Decision model (Beta), which screens calls first and hands
  unclear ones to the approval model, falling back to model review without
  OpenRouter), "Context compaction strategy" (recommended settings versus
  Passive compaction) and "Context compaction method" (Model versus Semantic
  algorithm (Beta) and its recall tool). The steering guide has no
  button of its own; it opens from the Guides overview. The agent can also open any guide at a chosen step, shown
  only while its conversation is on screen; the transcript then reads
  "Opened the “…” guide". Their text is written in Simplified Chinese and English;
  Traditional Chinese shows the Simplified text and other languages show
  English, while the dialog's buttons follow the interface language.
- Update dialog: release notes and installing an update. The notes cover every
  version released after the installed one, up to the new version, newest
  first, each under its own version heading and date, in the interface
  language (English when that language has no notes). Clicking the update
  notice above the workbench checks again in place before opening the dialog.
  Pine also checks for updates every two hours. An ongoing download or
  installation keeps its selected version.
- Quit confirmation, when sessions are still running, Remote Control is on, or
  WeChat remote is listening ("WeChat remote is on. Tasks sent from WeChat
  will not arrive after you quit."; not shown while it is paused or needs a
  new scan).
- Confirmation dialogs for deleting projects, sessions, folders, Skills and
  memories,
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
Quick composer, with more than one user a "Switch User" list of every user
(the current one checked; picking another restarts Pine as them), switches
for Browser access, Remote Control via Aldine and
"WeChat remote" (pauses or resumes receiving tasks from WeChat, the same as
"Receive tasks from WeChat" in Settings; greyed out until a WeChat account is
connected), a "WeChat: scan again needed" line when WeChat's login has to be
renewed, a "Keep computer awake for remote control" checkbox (the same
setting as in Settings › Remote control), "Manage more settings…" (opens
Pine Settings › Remote control), a count of running sessions while any run,
and Quit Pine. Quitting from the menu is the way to stop automations, Remote Control and WeChat remote.

## Keyboard shortcuts

- Mod+N or Mod+T: new tab
- Mod+W: close tab (middle-click a tab also closes it)
- Mod+Shift+T: reopen the last closed tab
- Mod+Shift+N: new window
- Mod+Shift+R: reload the window (plain Mod+R never reloads Pine)
- Mod+1 … Mod+8: jump to that tab; Mod+9: the last tab
- Mod+Alt+Left / Right or Mod+[ / Mod+]: previous / next tab
- Mod+B: toggle left sidebar
- Mod+Alt+B: toggle workbench (does nothing while no tab is open)
- Mod+,: Pine Settings
- Mod+K: search sessions
- Mod+P: Pine Settings › Projects
- Mod+S: Skills manager
- Mod+U: Automations manager
- Mod+/: MCP servers manager
- Mod+L: focus the composer
- Mod+R: open the composer's approval mode menu (outside other text
  fields)
- Mod+I: open the composer's model menu (outside other text fields)
- Tab or → in an empty composer showing a reply suggestion: use the
  suggestion
- ↑/↓ in an empty composer showing several reply suggestions: show the
  previous/next suggestion (stops at the first and last)
- Composer text box: Enter sends and scrolls the conversation smoothly to
  the new message; Option+Enter (Alt+Enter) sends without moving the
  conversation; Shift+Enter starts a new line
- Mod+Enter: Optimize prompt in the composer; Esc cancels it
- Enlarged Markdown image: Left / Right previous / next image; Mod+= / Mod+−
  zoom in / out; Mod+0 fit to window; Esc closes
- File preview with text selected: Mod+Alt+M comments on the selection; in
  the comment box Enter saves, Shift+Enter starts a new line and Esc cancels
- File preview while drawing an area to comment on: Esc cancels
- Guide dialog: Left / Right previous / next step
- Who's using Pine?: arrow keys move between users; Return or Space opens
  one; 1–9 open that user
- Audio and video preview: Space or K play / pause; Left / Right seek 5
  seconds; J / L seek 10 seconds; M mute; F full screen (video); I / O mark
  the start / end of a span to comment on; Esc clears the marks
