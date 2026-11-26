import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { UI_OPEN_GUIDE_TOOL_NAME } from "../shared/agent";
import { HELP_TOPIC_IDS, type HelpTopicId } from "../shared/helpTopics";

export interface PineGuideToolContext {
  /** Opens the guide, at a 0-based step, in the session's window. */
  openGuide(toolCallId: string, topic: HelpTopicId, step?: number): void;
}

/** What each guide teaches, step by step, for the agent to pick from. */
const GUIDE_OUTLINES: Record<HelpTopicId, readonly string[]> = {
  "approval-modes": [
    "what tool calls are",
    "the four approval modes",
    "reading an approval card",
    "good habits",
  ],
  "context-window": [
    "what the context is",
    "tokens and cost, caching",
    "compaction",
    "keeping the context lean, memory",
  ],
  models: [
    "models come from providers",
    "connecting a provider",
    "picking a model, specialized models",
    "good habits",
  ],
  "reasoning-effort": [
    "thinking before answering",
    "setting the effort",
    "good habits",
  ],
  "steer-stop": [
    "steering while Pine works, Withdraw and Send now",
    "stopping and what a stop keeps",
    "good habits",
  ],
  "project-folders": [
    "projects as folders, Read only and Read and write",
    "the sandbox and crossing it",
    "good habits",
  ],
  "auto-approval-path": [
    "Model review vs Decision model (Beta) and how they work together",
  ],
  "compaction-strategy": ["Use recommended settings vs Passive compaction"],
  "compaction-method": ["Model vs Semantic algorithm (Beta)"],
  memory: [
    "what memory is, project and global notes, asking Pine to remember",
    "the Memory manager, Unverified notes, turning memory off",
  ],
  "sub-sessions": [
    "splitting work into sub-sessions, where they appear, notices to the parent, limits",
  ],
  assistant: [
    "the Assistant: one conversation above every project that dispatches work and reports back, dispatch cards, From Assistant marks, its model and mode, attachments it hands on, its notes in the Memory manager, deleting its conversation",
  ],
  workbench: [
    "the workbench and its panels",
    "Artifacts: deliverables, folders, versions, dragging out",
  ],
  "work-style": [
    "work style (Full takeover, Collaborate), communication style, technical background, Aldine methodology",
  ],
  skills: [
    "what a Skill is, how Pine picks one, global and project Skills, creating one with Pine",
  ],
  mcp: [
    "what MCP servers add, project and all-projects servers, adding one with Pine, status",
  ],
  automations: [
    "what automations are, the four kinds of trigger, creating one with Pine",
    "how runs work: permissions, Activity, notifications, Secrets, running in the background",
  ],
  "best-practices": [
    "handing over a task well: the goal, material, room to work, self-checks, keeping what works",
  ],
};

const OUTLINE_TEXT = HELP_TOPIC_IDS.map(
  (id) =>
    `${id}: ${GUIDE_OUTLINES[id].map((step, index) => `${index + 1}) ${step}`).join("; ")}`,
).join("\n");

const params = Type.Object({
  topic: Type.Union(
    HELP_TOPIC_IDS.map((id) => Type.Literal(id)),
    { description: "The guide to open." },
  ),
  step: Type.Optional(
    Type.Integer({
      minimum: 1,
      description:
        "1-based step to open at; defaults to the first. Past the last step opens the last.",
    }),
  ),
});

/**
 * Lets the agent open one of Pine's illustrated guides for the user, the
 * same dialog the guide buttons open. Fire-and-forget: it only shows a
 * dialog the user can close, so it needs no approval.
 */
export function createGuideToolDefinitions(
  context: PineGuideToolContext,
): ToolDefinition[] {
  return [
    defineTool({
      name: UI_OPEN_GUIDE_TOOL_NAME,
      label: "Open Guide",
      description: `Open one of Pine's illustrated guides over the user's window, the same dialog Pine's guide buttons open. It appears only while this conversation is on screen. Guides and their steps:\n${OUTLINE_TEXT}`,
      promptSnippet: `Use ${UI_OPEN_GUIDE_TOOL_NAME} when the user is unsure how a Pine feature works and one of the guides covers it`,
      promptGuidelines: [
        `Open a guide when the user asks how something in Pine works, seems confused by approvals, context, models, reasoning effort, steering or project folders, or asks for a tutorial. Pick the step that answers the question. Still answer briefly in words; the guide adds the picture, it does not replace your reply.`,
        `Do not open guides unprompted in the middle of other work, and do not open the same guide again in the same conversation unless the user asks.`,
      ],
      parameters: params,
      prepareArguments: (args) => args as Static<typeof params>,
      execute: (toolCallId, input) => {
        // The schema is built from the id list, which TypeBox can't narrow.
        const topic = input.topic as HelpTopicId;
        const step = input.step ? input.step - 1 : undefined;
        context.openGuide(toolCallId, topic, step);
        const at = input.step ? ` at step ${String(input.step)}` : "";
        return Promise.resolve({
          content: [
            {
              type: "text" as const,
              text: `Opened the ${topic} guide${at}. It shows only while this conversation is on screen; the user closes it when done.`,
            },
          ],
          details: { topic, step },
        });
      },
    }),
  ];
}
