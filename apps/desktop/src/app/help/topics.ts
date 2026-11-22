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
} as const satisfies Record<HelpTopicId, readonly HelpIllustrationId[]>;

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
