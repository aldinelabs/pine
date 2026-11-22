/**
 * Pine's built-in guides: short illustrated tutorials opened from a guide
 * button or menu item beside a feature, or by the agent. The structure lives here,
 * language-free; each locale's text is in `content/`.
 */

import type { HelpTopicId } from "@/shared/helpTopics";

export {
  HELP_TOPIC_IDS,
  isHelpTopicId,
  type HelpTopicId,
} from "@/shared/helpTopics";

/** The illustration each step shows, in step order. */
export const HELP_TOPIC_STEPS = {
  "approval-modes": ["tool-call", "approval-modes", "approval-card", "tips"],
  "context-window": [
    "context-fill",
    "context-tokens",
    "context-compaction",
    "tips",
  ],
  models: ["model-provider", "provider-connect", "model-picker", "tips"],
  "reasoning-effort": ["reasoning-think", "reasoning-levels", "tips"],
  "steer-stop": ["steer-message", "stop-turn", "tips"],
  "project-folders": ["project-folders", "sandbox", "tips"],
  "auto-approval-path": ["approval-path"],
  "compaction-strategy": ["compaction-strategy"],
  "compaction-method": ["compaction-method"],
  memory: ["memory-notes", "memory-manager"],
  "sub-sessions": ["sub-sessions"],
  workbench: ["workbench-panels", "artifacts"],
  "work-style": ["work-style"],
  skills: ["skills"],
  mcp: ["mcp"],
  automations: ["automation-triggers", "automation-runs"],
} as const satisfies Record<HelpTopicId, readonly HelpIllustrationId[]>;

export type HelpTopicGroupId = "start" | "work" | "extend" | "settings";

/**
 * How the Guides overview groups the guides, in reading order. Every guide
 * appears in exactly one group.
 */
export const HELP_TOPIC_GROUPS: readonly {
  id: HelpTopicGroupId;
  topics: readonly HelpTopicId[];
}[] = [
  {
    id: "start",
    topics: ["approval-modes", "models", "context-window"],
  },
  {
    id: "work",
    topics: [
      "steer-stop",
      "reasoning-effort",
      "project-folders",
      "memory",
      "sub-sessions",
      "workbench",
      "work-style",
    ],
  },
  { id: "extend", topics: ["skills", "mcp", "automations"] },
  {
    id: "settings",
    topics: ["auto-approval-path", "compaction-strategy", "compaction-method"],
  },
];

export type HelpIllustrationId =
  | "tool-call"
  | "approval-modes"
  | "approval-card"
  | "context-fill"
  | "context-tokens"
  | "context-compaction"
  | "model-provider"
  | "provider-connect"
  | "model-picker"
  | "reasoning-think"
  | "reasoning-levels"
  | "steer-message"
  | "stop-turn"
  | "project-folders"
  | "sandbox"
  | "approval-path"
  | "compaction-strategy"
  | "compaction-method"
  | "memory-notes"
  | "memory-manager"
  | "sub-sessions"
  | "workbench-panels"
  | "artifacts"
  | "work-style"
  | "skills"
  | "mcp"
  | "automation-triggers"
  | "automation-runs"
  | "tips";

export interface HelpStepText {
  title: string;
  /** Plain paragraphs. */
  body: readonly string[];
  /** Optional bullet points under the paragraphs. */
  points?: readonly string[];
  /** A highlighted closing line: a tip, or a caution about a risk. */
  note?: { tone: "tip" | "caution"; text: string };
}

export interface HelpTopicText {
  title: string;
  /** One sentence under the title. */
  summary: string;
  /** One entry per step of `HELP_TOPIC_STEPS[topic]`, in the same order. */
  steps: readonly HelpStepText[];
}

export type HelpContent = Record<HelpTopicId, HelpTopicText>;
