import type { HelpContent } from "../topics";

export default {
  "approval-modes": {
    title: "Tool calls and approvals",
    summary:
      "Pine doesn't just chat; it does things. Approvals decide when it asks you first.",
    steps: [
      {
        title: "An agent acts through tools",
        body: [
          "A chatbot only writes text. Pine is an agent: to get a task done it calls tools, such as reading and writing files, running commands, searching the web or using a browser.",
          "Every tool call shows as a line in the conversation. Click it to see exactly what it did and what came back.",
        ],
        note: {
          tone: "tip",
          text: "How it works: the model writes down which tool it wants and with what parameters; Pine checks the request, runs it, and hands the result back for the model to keep thinking.",
        },
      },
      {
        title: "The four approval modes",
        body: [
          "Every command Pine runs is sandboxed to the project's folders. The approval mode decides whether Pine asks before acting, and who makes the call:",
        ],
        points: [
          "Auto Approve: everyday work just goes ahead. Actions that leave the project, look destructive or need more privileges go to the approval model first, which lets safe ones through and asks you only when it is unsure. The recommended place to start.",
          "Autonomous Work: the approval model reviews the same actions but never stops to wait for you; whatever it rejects is skipped. For long tasks while you are away.",
          "Let Me Review: asks you before every command and every change to a file (reading files doesn't ask). For tasks you want to check step by step.",
          "YOLO: removes every limit, with no checks and no questions. Not recommended.",
        ],
        note: {
          tone: "tip",
          text: "Today's models are very capable: give them room and they often go further than you expect. For things that can't be undone, such as payments or messages to other people, switch to Let Me Review for that task.",
        },
      },
      {
        title: "Reading an approval card",
        body: [
          "When Pine needs you, an approval card takes the place of the text box. It says what Pine wants to do and why it is asking.",
        ],
        points: [
          "Approve: allows this one action.",
          "Reject: declines; Pine tries another way or stops.",
          "Reject with guidance: declines and tells Pine what to do instead, which helps far more than a bare rejection.",
        ],
        note: {
          tone: "tip",
          text: "Not sure? Open Technical details to see the exact parameters that would run.",
        },
      },
      {
        title: "Getting the most out of it",
        body: ["A few habits that help:"],
        points: [
          "Start with Auto Approve and hand Pine whole tasks; see how far it gets.",
          "State the goal and the limits up front: what done looks like, which files it may change, what to leave alone. You'll see fewer approvals, and the reviews get more accurate.",
          "Give a project only the folders it needs, and make the ones it shouldn't change Read only. Clear limits make it easy to give Pine more room.",
          "The mode is saved with each conversation, so pick it per task: the shield button below the text box, or ⌘/Ctrl + R.",
        ],
      },
    ],
  },
  "context-window": {
    title: "Context and tokens",
    summary:
      "Before every answer the model rereads the whole context. It has a size limit, and it drives the cost.",
    steps: [
      {
        title: "Context is the model's desk",
        body: [
          "The model itself remembers nothing between answers. Each time, Pine hands it the whole conversation again: your messages, its replies, files it read, results from tools, and Pine's own instructions. That bundle is the context.",
          "The context has a maximum size, the context window. The ring below the text box shows how much of it is in use.",
        ],
        note: {
          tone: "tip",
          text: "How it works: the model has no long-term memory; what it “remembers” is only the context it is given this time.",
        },
      },
      {
        title: "Tokens and cost",
        body: [
          "Context is measured in tokens, the small pieces models cut text into. An English word is about one token; a Chinese character is one or two.",
          "Because every turn rereads the whole context, a long conversation makes each turn slower and more expensive. Caching helps: when the unchanged start of the context hits the provider's cache, it is usually billed at a lower price. Cache hit rate in the popover shows that share.",
        ],
        note: {
          tone: "tip",
          text: "Worried about spending? Turn on Session cost limit in the same popover; Pine stops the session when it reaches the limit.",
        },
      },
      {
        title: "Compaction tidies up when it fills",
        body: [
          "By default, when the context reaches 80% (at most about 400K tokens), Pine compacts it on its own: earlier parts of the conversation become a summary that keeps the goals, key decisions and changed files, freeing room to keep working. A compaction marker appears in the conversation. You can change this in Settings › Agent › Context compaction strategy.",
          "You can also compact at any time with Compact context now, for example when one stage is done and the next is about to start.",
        ],
        note: {
          tone: "tip",
          text: "The summary leaves out some detail, but the full conversation is still kept, and Pine looks back through it when it needs to. If a detail really matters, ask Pine to check the earlier messages, or just say it again; neither has a downside.",
        },
      },
      {
        title: "Keeping the context lean",
        body: ["A few habits that help:"],
        points: [
          "One task, one conversation. For an unrelated new task, start a new session instead of continuing the old one.",
          "Attach only the files that matter. A whole folder or a very long document takes a big bite of the context.",
          "No need to watch the ring. Compaction happens on its own, so you can hand Pine long tasks and let it keep going.",
          "To have Pine remember something from now on, just tell it “Remember: …”, for example “Remember: write my reports in English.” It also notes things worth keeping on its own. You can review and edit the notes in the sidebar under More › Memory.",
        ],
      },
    ],
  },
  models: {
    title: "Models and providers",
    summary:
      "The model does the thinking and the work. Connect a provider, pick a model, and Pine is ready to go.",
    steps: [
      {
        title: "Models come from providers",
        body: [
          "Pine is the workbench; the model is what thinks and writes. Pine doesn't ship with a model of its own: you connect a provider such as OpenAI, Anthropic or Google, or a service like OpenRouter that gives you many of them in one place.",
          "Every turn, Pine sends the context to the model you picked and brings the reply back. The provider bills by the token, to your account or subscription with them.",
        ],
        note: {
          tone: "tip",
          text: "How it works: models differ in what they're good at, how fast they are and what they cost, so Pine lets you choose and switch at any time.",
        },
      },
      {
        title: "Connecting a provider",
        body: [
          "Click the model button below the text box, choose Browse all models…, then Manage providers and models to see the built-in provider catalog. Pick one and follow the steps:",
        ],
        points: [
          "Sign in: some providers let you sign in with your account or subscription; you approve it in the browser.",
          "API key: create a key on the provider's website and paste it in. You pay for what you use.",
          "Custom provider: models you host yourself or run on this computer can be added with Add model. For a local server that needs no key, any placeholder value works.",
        ],
        note: {
          tone: "tip",
          text: "Connections are saved only on this computer and only ever sent to that provider. Treat an API key like a bank card and keep it to yourself; you can Disconnect a provider at any time.",
        },
      },
      {
        title: "Picking a model",
        body: [
          "The model menu lists your favorite or recently used models, and Browse all models… searches all of them. Models marked Recommended are the ones Pine currently recommends; when in doubt, start there.",
          "The model is saved with each conversation: switching in a running conversation changes only that one, and the model you pick in a new conversation becomes the default for new ones.",
        ],
        note: {
          tone: "tip",
          text: "Side jobs such as titles, auto-approval and reply suggestions use models too. You can pick separate ones, for example faster and cheaper models, in Settings › Models › Specialized models.",
        },
      },
      {
        title: "Getting the most out of it",
        body: ["A few habits that help:"],
        points: [
          "Start with a recommended model, give it a real task, and adjust from what you see.",
          "Big pieces of code, long reports and multi-step research are worth a stronger model; tidying files or renaming things is fine with a faster one.",
          "Favorite the models you use often and they appear at the top of the model menu. ⌘/Ctrl + I opens that menu at any time.",
          "To stay within a budget, turn on Session cost limit in the Context usage popover.",
        ],
      },
    ],
  },
  "reasoning-effort": {
    title: "Reasoning effort",
    summary:
      "A model can think before it answers. Reasoning effort sets how long and how deep.",
    steps: [
      {
        title: "Think first, then answer",
        body: [
          "Models that support reasoning think before they answer: they break the problem down, try a few approaches and check their conclusions, then act or reply.",
          "While the model thinks, a Thinking line appears in the conversation; afterwards it shows how long it took. Click it to read what the provider sent back of the reasoning.",
        ],
        note: {
          tone: "tip",
          text: "How it works: the model first writes reasoning tokens, then the answer. More thinking means more tokens.",
        },
      },
      {
        title: "Setting the effort",
        body: [
          "Reasoning effort is in the model menu. The further right the slider, the longer and more carefully the model thinks, and the slower and costlier the answer. The levels depend on the model; Low, Medium, High and Extra high are common.",
          "Medium is the usual default. Like the model, the effort is saved with each conversation.",
        ],
        note: {
          tone: "tip",
          text: "Modern models do their best work in Pine with reasoning on, so we don't recommend turning it off. Maximum is often slower and costlier without being better.",
        },
      },
      {
        title: "Getting the most out of it",
        body: ["A few habits that help:"],
        points: [
          "Medium suits most tasks and makes a good everyday setting.",
          "For tricky debugging, architecture decisions or problems that need careful reasoning, move to High or Extra high.",
          "Stating the goal and the limits clearly often helps more than turning the effort up.",
          "Answers too slow? Try one level lower, or a faster model.",
        ],
      },
    ],
  },
  "steer-stop": {
    title: "Steering and stopping",
    summary:
      "While Pine works, you can add requirements, change direction or stop it at any time.",
    steps: [
      {
        title: "Talk while it works",
        body: [
          "The text box keeps working while Pine does. Type a new requirement and press Enter or click Steer response: the message waits above the text box until Pine finishes its current step, then goes to the model. Pine carries on with the new requirement instead of starting over.",
          "Until the message is taken, two buttons sit below it: Withdraw puts it back in the text box; Send now interrupts the current work and handles your message right away.",
        ],
        note: {
          tone: "tip",
          text: "How it works: steering reaches the model between steps, so an action already running isn't cut off.",
        },
      },
      {
        title: "Stop at any time",
        body: [
          "With the text box empty, the button turns into Stop response; you can also press Esc. Pine stops at once: running commands are ended and the step that was cut off is marked Stopped.",
          "Changes already made stay in place; stopping doesn't undo them. Afterwards, tell Pine what to do next, or ask it to change things back.",
        ],
        note: {
          tone: "tip",
          text: "Files submitted to Artifacts keep their earlier versions, and Version history restores any of them. Commands that moved to the background keep running after a stop; you can see or end them under Background processes.",
        },
      },
      {
        title: "Getting the most out of it",
        body: ["A few habits that help:"],
        points: [
          "Hand the task over and add to it as you watch. It's far easier than writing the perfect instructions up front.",
          "If it's heading the wrong way, say so early. A quick “try another approach” is often faster than stopping and explaining everything again.",
          "Option/Alt + Enter steers without jumping to the bottom, so you can keep reading earlier messages while you add to them.",
          "To go back and redo from an earlier point, use Edit message and send again. The conversation continues from there, but file changes aren't reverted.",
        ],
      },
    ],
  },
  "project-folders": {
    title: "Projects and folder access",
    summary:
      "A project decides which folders Pine can touch. With clear limits, you can give it plenty of room.",
    steps: [
      {
        title: "A project is a set of folders",
        body: [
          "Each project has a default folder and, optionally, a few additional context folders. Conversations in the project can reach only these folders.",
          "Each folder is either Read and write or Read only. The default folder must be writable; it's where Pine mostly works. Folders it only needs to look at, such as notes or reference code, can be Read only.",
        ],
        note: {
          tone: "tip",
          text: "No Project is for quick jobs that belong to no project. Pine works in a space inside its own data folder and doesn't touch your files.",
        },
      },
      {
        title: "The sandbox keeps the limits",
        body: [
          "Every command Pine runs is sandboxed: it can read only the project's folders, files you attached and the system files it needs, and write only to writable folders and the project's own temporary folder. Commands can't go online either; searching and opening web pages are done by dedicated tools.",
          "When something needs to cross the line, such as a file outside the project, the approval mode decides: in Auto Approve the approval model judges first and asks you only when unsure; in Let Me Review you're asked directly.",
        ],
        note: {
          tone: "tip",
          text: "How it works: the limits are enforced by a system-level sandbox, not by the model's good behaviour. Draw the lines, then let it run.",
        },
      },
      {
        title: "Getting the most out of it",
        body: ["A few habits that help:"],
        points: [
          "Add only the folders the task needs. Clear limits make it easy to let go.",
          "Make notes and reference material Read only: Pine can look at them any time but won't change them.",
          "Pine keeps drafts and temporary files in the project's own temporary folder, away from your folders. You can clear them in Settings › Projects.",
          "Deleting a project removes only Pine's conversations and settings; your folders stay as they are.",
        ],
      },
    ],
  },
  "auto-approval-path": {
    title: "Automatic approval path",
    summary: "Who decides whether an action that needs a check can go ahead.",
    steps: [
      {
        title: "Two approval paths",
        body: [
          "In Auto Approve and Autonomous, actions that reach beyond the project, could be destructive or need more permissions are reviewed first. This setting decides who reviews them:",
        ],
        points: [
          "Model review (the default): every review goes to the approval model. It reads the call and the conversation, then gives a decision and its reasons. You can pick the approval model in Settings › Models › Specialized models.",
          "Decision model (Beta): a dedicated decision model screens each call first, quickly. Clearly fine calls go ahead; calls that really need your say show an approval card, explained by the approval model; unclear or likely-denied calls go to the approval model for the final decision. Everyday actions get through faster.",
        ],
        note: {
          tone: "tip",
          text: "The decision model runs through OpenRouter, so connect OpenRouter first. Without it, or if screening times out or fails, Pine switches to model review on its own and work carries on. Autonomous never stops to ask you, so screening there either lets a call through or hands it to the approval model.",
        },
      },
    ],
  },
  "compaction-strategy": {
    title: "Context compaction strategy",
    summary: "How full the context gets before Pine compacts it.",
    steps: [
      {
        title: "Two compaction strategies",
        body: [
          "As a conversation grows, Pine turns earlier parts into a summary to free room for more work. This setting decides when:",
        ],
        points: [
          "Use recommended settings (the default): compacts when the context reaches 80% of the window, at most about 400K tokens. The context stays lean, each turn costs less and the model stays focused.",
          "Passive compaction: compacts as late as possible, when only about 16K tokens of the window are left. More of the original text stays, but each turn reads more and costs more.",
        ],
        note: {
          tone: "tip",
          text: "After compaction the full history stays stored in the session, and Pine looks back through it on its own when needed. The recommended settings suit most work.",
        },
      },
    ],
  },
  "compaction-method": {
    title: "Context compaction method",
    summary:
      "Who writes the summary of earlier conversation when Pine compacts.",
    steps: [
      {
        title: "Two compaction methods",
        body: [
          "When Pine compacts, earlier conversation becomes a summary the model works from. This setting decides how the summary is made:",
        ],
        points: [
          "Model (the default): the current model reads the earlier conversation and writes the summary. It understands the most, but takes one model call's time and tokens.",
          "Semantic algorithm (Beta): no model call. Rules pick out goals, changed files, commits and a brief account of what happened. It's almost instant and costs no tokens. Pine also gets a recall tool, so it can search the full history for the original text when it needs details.",
        ],
        note: {
          tone: "tip",
          text: "Neither method deletes history: the original conversation stays stored in the session.",
        },
      },
    ],
  },
  memory: {
    title: "Memory",
    summary:
      "Pine can remember your preferences and decisions, so you don't have to explain them again.",
    steps: [
      {
        title: "Ask Pine to remember",
        body: [
          "A model starts every conversation from scratch. Memory lets Pine keep what's worth keeping as notes: later conversations start with the list of notes and read one in full when it's relevant.",
          'To have it remember something, just say so, for example "Remember: weekly reports use a table, amounts with two decimals". Pine also saves notes on its own when it learns something worth keeping, such as a correction you made, a detail of your setup or a decision.',
        ],
        points: [
          "Project notes appear only in that project's conversations. Good for project conventions and background.",
          "Global notes are seen in every project. Good for your personal habits and preferences.",
        ],
        note: {
          tone: "tip",
          text: "Saving or deleting a note shows as a tool call in the conversation, so you can always see what Pine wrote down.",
        },
      },
      {
        title: "Review and tidy your memory",
        body: [
          "The sidebar's More › Memory lists every note in two tabs, This project and All projects. Each note has a name and a one-line summary; Edit changes the summary and details, or deletes the note.",
        ],
        points: [
          "Notes marked Unverified are things Pine inferred and nobody has confirmed. Pine treats them as leads, not facts; once you know a note is right, turn on Verified.",
          "The easiest way to correct a note is to tell Pine; it rewrites that note.",
          "To stop using memory, turn off Remember across sessions in Settings › Agent. Pine then neither reads nor saves notes, and the existing notes stay.",
        ],
        note: {
          tone: "tip",
          text: "Automation runs neither read nor save memory; each run works only from its own definition.",
        },
      },
    ],
  },
  "sub-sessions": {
    title: "Sub-sessions",
    summary: "Split a big task so several sub-sessions work on it at once.",
    steps: [
      {
        title: "Let Pine split the work",
        body: [
          "When work splits cleanly, such as separate research questions, edits to separate files or a broad search, Pine can start sub-sessions and move them forward in parallel, like sending out helpers. Each sub-session is a full conversation with its own context, so the main session doesn't fill up with details.",
          'You can ask for this directly, for example "Start three sub-sessions, one to research each of these companies".',
        ],
        points: [
          "Sub-sessions appear in the sidebar under their parent, indented one level. The arrow beside the parent shows or hides them; open any of them to see how it's going.",
          "When a sub-session finishes a turn or waits for approval, Pine tells the parent, so nothing needs watching.",
          "Sub-sessions work in the parent's project and go one level deep, and their approval mode is never looser than the parent's. Deleting the parent deletes them too.",
          "To start a separate conversation in another project, ask Pine for a separate session.",
        ],
        note: {
          tone: "tip",
          text: "For short tasks, or steps that depend on each other, Pine just does the work itself; there's no need to ask it not to split.",
        },
      },
    ],
  },
  workbench: {
    title: "Workbench",
    summary:
      "The panel beside the conversation: collect results, preview files, watch background processes.",
    steps: [
      {
        title: "What's in the workbench",
        body: [
          "The workbench is the panel on the right of a session. Open it with Toggle workbench in the title bar or ⌘/Ctrl + Alt + B. It holds up to two cards, one above the other, and each card's switcher picks a panel:",
        ],
        points: [
          "Artifacts: the results Pine delivers to you.",
          "Preview: the file Pine showed last, or the one you picked in Artifacts.",
          "Background processes: long-running programs Pine started, with their output.",
          "Files: the project's file tree and each folder's access.",
          "Side chat: a separate, read-only discussion about this session that doesn't interrupt the work.",
        ],
        note: {
          tone: "tip",
          text: "Open in tab, in a card's header, moves the content to the main area for more room.",
        },
      },
      {
        title: "Artifacts",
        body: [
          "When Pine finishes a task, it submits the files it delivers to Artifacts, each with a title and a one-line description, newest first. Files it only showed to report progress or compare options stay out: this list holds results.",
        ],
        points: [
          "When there are many files, Pine files them into folders, such as Reports › Week 1. Folders only organize the list; the files stay where they are on disk. To group them differently, just tell Pine.",
          "Every submission keeps a copy. A file with a clock badge has several versions; right-click it › Version history to look back and compare.",
        ],
        note: {
          tone: "tip",
          text: "Drag an artifact straight onto your file manager, the desktop or another app, or into the message box.",
        },
      },
    ],
  },
} satisfies HelpContent;
