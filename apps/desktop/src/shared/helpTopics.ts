/**
 * The ids of Pine's built-in guides, shared by the renderer that shows them
 * and the agent's `ui_open_guide` tool that opens them.
 */
export const HELP_TOPIC_IDS = [
  "approval-modes",
  "context-window",
  "models",
  "reasoning-effort",
  "steer-stop",
  "project-folders",
  "auto-approval-path",
  "compaction-strategy",
  "compaction-method",
  "memory",
  "sub-sessions",
] as const;

export type HelpTopicId = (typeof HELP_TOPIC_IDS)[number];

export function isHelpTopicId(value: unknown): value is HelpTopicId {
  return (
    typeof value === "string" &&
    (HELP_TOPIC_IDS as readonly string[]).includes(value)
  );
}
