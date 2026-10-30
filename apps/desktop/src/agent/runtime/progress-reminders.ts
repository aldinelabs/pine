import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import {
  formatListLine,
  replayTodoState,
  selectReadyTasks,
  selectTasksByStatus,
  TODO_TOOL_NAME,
  type TaskState,
} from "@pine/rpiv-todo";

export const TODO_REMINDER_TURN_INTERVAL = 16;
export const TODO_REMINDER_HEADING = "[Pine progress reminder]";
const REMINDER_FOOTER =
  "Do not add tasks for work that is already finished, and do not mention this reminder to the user.";

const taskRefs = (ids: readonly number[]) =>
  ids.map((id) => `#${id}`).join(", ");

/**
 * The reminder for the current list, or nothing when there is no unfinished
 * work. Without a list it stays silent: a late prompt to create one only
 * produced single tasks for work that was already done.
 */
export function buildProgressReminder(state: TaskState): string | undefined {
  const groups = selectTasksByStatus(state);
  const unfinished = [...groups.inProgress, ...groups.pending];
  if (unfinished.length === 0) return undefined;
  const total = unfinished.length + groups.completed.length;
  const lines = [
    TODO_REMINDER_HEADING,
    `Current todo list (${groups.completed.length}/${total} completed):`,
    ...state.tasks
      .filter(
        (task) => task.status === "pending" || task.status === "in_progress",
      )
      .map(formatListLine),
  ];
  if (groups.inProgress.length > 0) {
    const active = taskRefs(groups.inProgress.map((task) => task.id));
    lines.push(
      `If ${active} is finished and verified, mark it completed now and mark the next step in_progress; otherwise keep going. Revise or delete the remaining steps if the plan changed.`,
    );
  } else {
    const ready = selectReadyTasks(state).map((task) => task.id);
    lines.push(
      ready.length > 0
        ? `No task is in_progress. Mark the step you are working on in_progress before continuing (ready now: ${taskRefs(ready)}). Mark steps that are already finished and verified completed.`
        : "No task is in_progress. Mark the step you are working on in_progress before continuing, and mark steps that are already finished and verified completed.",
    );
  }
  lines.push(REMINDER_FOOTER);
  return lines.join("\n");
}

/** Per-session turn cadence; parallel tool batches receive only one reminder. */
export function createProgressRemindersExtension(): InlineExtension {
  return {
    name: "pine-progress-reminders",
    factory: (pi) => {
      let turnsSinceReview = 0;
      pi.on("turn_start", () => {
        turnsSinceReview += 1;
      });
      pi.on("tool_result", (event, ctx) => {
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
        // Start a fresh interval even when the model ignores the reminder or
        // there is nothing to remind about, so the branch is read once per
        // interval.
        turnsSinceReview = 0;
        const reminder = buildProgressReminder(
          replayTodoState(ctx.sessionManager.getBranch()),
        );
        if (!reminder) return;
        return {
          content: [
            ...event.content,
            { type: "text", text: `\n\n${reminder}` },
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
