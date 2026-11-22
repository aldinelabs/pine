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
} satisfies HelpContent;
