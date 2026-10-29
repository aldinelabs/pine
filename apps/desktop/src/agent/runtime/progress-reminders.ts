import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { TODO_TOOL_NAME } from "@pine/rpiv-todo";

export const TODO_REMINDER_TURN_INTERVAL = 16;
export const TODO_PROGRESS_REMINDER =
  "[Pine progress reminder]\nReview the todo list for the current request. For ongoing multi-step work, keep concrete steps current: mark the current step in_progress, mark only actually finished and verified steps completed, and add or revise steps when the plan changes. Use todo list if you need to check its state. If no list exists and this work is substantial, create one; skip lists for trivial or already finished requests. Do not report this reminder as a user request or claim progress that has not happened.";

/** Per-session turn cadence; parallel tool batches receive only one reminder. */
export function createProgressRemindersExtension(): InlineExtension {
  return {
    name: "pine-progress-reminders",
    factory: (pi) => {
      let turnsSinceReview = 0;
      pi.on("turn_start", () => {
        turnsSinceReview += 1;
      });
      pi.on("tool_result", (event) => {
        if (event.toolName === TODO_TOOL_NAME) {
          const failed =
            event.isError ||
            (typeof event.details === "object" &&
              event.details !== null &&
              "error" in event.details);
          if (!failed) turnsSinceReview = 0;
          return;
        }
        if (
          event.parentToolCallId ||
          turnsSinceReview < TODO_REMINDER_TURN_INTERVAL ||
          !pi.getActiveTools().includes(TODO_TOOL_NAME)
        )
          return;
        // Start a fresh interval even when the model ignores the reminder.
        turnsSinceReview = 0;
        return {
          content: [
            ...event.content,
            { type: "text", text: `\n\n${TODO_PROGRESS_REMINDER}` },
          ],
          // Pi drops structured content when a hook replaces the text unless
          // it is explicitly carried through. Keep the tool's data intact.
          ...(event.structuredContent === undefined
            ? {}
            : { structuredContent: event.structuredContent }),
        };
      });
    },
  };
}
