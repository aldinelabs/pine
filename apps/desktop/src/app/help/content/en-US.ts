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
          "Commands run in a sandbox that can only touch the project's folders. Only actions beyond that (writing outside the project, deleting, installing from the internet, elevated rights and the like) need approval. The approval mode decides who makes the call:",
        ],
        points: [
          "Auto Approve: the approval model looks first, lets safe actions through and asks you only when it is unsure. The recommended place to start.",
          "Autonomous Work: the approval model decides on its own and never stops to wait for you; whatever it rejects is skipped. For long tasks while you are away.",
          "Let Me Review: asks you before every such action, for tasks you want to check step by step.",
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
          "When the context is nearly full, Pine compacts it: earlier parts of the conversation become a summary that keeps the goals, key decisions and changed files, freeing room to keep working. A compaction marker appears in the conversation.",
          "You can also compact at any time with Compact context now, for example when one stage is done and the next is about to start.",
        ],
        note: {
          tone: "caution",
          text: "Compaction loses detail. If exact numbers or wording you gave earlier still matter, mention them again afterwards.",
        },
      },
      {
        title: "Keeping the context lean",
        body: ["A few habits that help:"],
        points: [
          "One task, one conversation. For an unrelated new task, start a new session instead of continuing the old one.",
          "Attach only the files that matter. A whole folder or a very long document takes a big bite of the context.",
          "When the ring turns red (over 80%), compact or start a new session before the next big task.",
          "Put lasting preferences in Memory rather than hoping they stay in one conversation's context.",
        ],
      },
    ],
  },
} satisfies HelpContent;
