// Handlers: tasks task kill. Background-task calls throw for a
// session that is not live, so liveness is tested first; a session that is
// not live has no processes to show or stop.

import type { BackgroundTaskSnapshot } from "@pine/pi-background-tasks";
import { specOf } from "../commandSpec";
import { PAGE_ROWS, TASK_OUTPUT_LINES, TASK_OUTPUT_MAX } from "../constants";
import { resolveRef } from "../parseCommand";
import { render } from "../replies";
import type { CommandName, HandleRow } from "../types";
import type {
  CommandContext,
  CommandHandler,
  CommandHandlers,
  CommandResult,
} from "./types";

/** `.task N` sends the latest output, then at most this many `.more` pages of earlier output. */
const TASK_MORE_PAGES = 3;

interface Target {
  sessionId: string;
  projectId: string;
  actor: number;
}

/** The current session, held, live, with the client that acts on it; or the reply instead. */
async function liveTarget(
  ctx: CommandContext,
): Promise<{ target: Target } | { result: CommandResult }> {
  const current = ctx.store.get().current;
  if (!current) return { result: { text: render("E-NOSESSION", ctx.lang) } };
  const { sessionId, projectId } = current;
  await ctx.sessions.hold(projectId);
  if (!ctx.sessions.isLive(sessionId))
    return { result: { text: render("R-TASKS", ctx.lang, { rows: [] }) } };
  return {
    target: {
      sessionId,
      projectId,
      actor: ctx.sessions.actor(sessionId, projectId),
    },
  };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    pages.push(items.slice(index, index + size));
  return pages;
}

function pageFooter(
  ctx: CommandContext,
  index: number,
  count: number,
  truncated: boolean,
): string {
  return render("R-PAGE", ctx.lang, { index: index + 1, count, truncated });
}

function withFooter(body: string, footer: string): string {
  return footer ? `${body}\n${footer}` : body;
}

function taskRow(task: BackgroundTaskSnapshot): HandleRow {
  return { id: task.id, label: task.name || task.command };
}

/** A task list reply: page 1 now, the rest behind `.more`. */
function taskList(
  ctx: CommandContext,
  tasks: readonly BackgroundTaskSnapshot[],
  sessionId: string,
): CommandResult {
  const pages = chunk(tasks, PAGE_ROWS);
  if (pages.length === 0) {
    ctx.pager.clear();
    return { text: render("R-TASKS", ctx.lang, { rows: [] }) };
  }
  const built = pages.map((page, index) => ({
    text: withFooter(
      render("R-TASKS", ctx.lang, {
        rows: page.map((task, i) => {
          const running = task.status === "running";
          return {
            n: i + 1,
            title: task.name || task.command,
            running,
            ...(running
              ? { runningMs: Math.max(0, ctx.now - task.startTime) }
              : {}),
            ...(typeof task.exitCode === "number"
              ? { exitCode: task.exitCode }
              : {}),
            command: task.command,
          };
        }),
      }),
      pages.length > 1 ? pageFooter(ctx, index, pages.length, false) : "",
    ),
    rows: page.map(taskRow),
  }));
  const [first, ...rest] = built;
  if (!first) return {};
  ctx.handles.set("task", first.rows, sessionId);
  ctx.pager.set(
    rest.map((page) => ({
      text: page.text,
      list: { kind: "task" as const, rows: page.rows, sessionId },
    })),
  );
  return { text: first.text, numbered: { kind: "task" } };
}

/** Resolves a task handle (or name) of the current session's table. */
async function pickTask(
  ctx: CommandContext,
  target: Target,
  ref: string,
): Promise<{ row: HandleRow } | { result: CommandResult }> {
  if (/^\d+$/.test(ref)) {
    const row = ctx.handles.resolve("task", Number(ref), target.sessionId);
    return row
      ? { row }
      : {
          result: {
            text: render("E-REF", ctx.lang, { n: ref, list: ".b" }),
          },
        };
  }
  const { tasks } = await ctx.core.runtimes.listBackgroundTasks(
    target.actor,
    target.sessionId,
  );
  const match = resolveRef(tasks.map(taskRow), ref);
  if (match.kind === "one") return { row: match.row };
  if (match.kind === "none")
    return {
      result: {
        text: render("E-NOMATCH", ctx.lang, { query: ref, kind: "task" }),
      },
    };
  const rows = match.rows.slice(0, PAGE_ROWS);
  ctx.handles.set("task", rows, target.sessionId);
  ctx.pager.clear();
  return {
    result: {
      text: render("R-MATCHES", ctx.lang, {
        query: ref,
        rows: rows.map((row, i) => ({ n: i + 1, label: row.label })),
      }),
      numbered: { kind: "task" },
    },
  };
}

/**
 * Output split from the end into blocks of at most TASK_OUTPUT_LINES lines and
 * TASK_OUTPUT_MAX code points: the first block is the latest output.
 */
function outputBlocks(
  output: string,
  maxBlocks: number,
): { blocks: string[]; truncated: boolean } {
  const rest = output.replace(/\r\n?/g, "\n").trimEnd().split("\n");
  const blocks: string[] = [];
  while (rest.length > 0 && blocks.length < maxBlocks) {
    const block: string[] = [];
    let points = 0;
    while (rest.length > 0 && block.length < TASK_OUTPUT_LINES) {
      const line = rest[rest.length - 1] ?? "";
      const chars = Array.from(line);
      const cost = chars.length + (block.length > 0 ? 1 : 0);
      if (points + cost <= TASK_OUTPUT_MAX) {
        block.unshift(line);
        points += cost;
        rest.pop();
        continue;
      }
      if (block.length === 0) {
        // One line longer than a block: its tail now, the rest later.
        block.unshift(chars.slice(-TASK_OUTPUT_MAX).join(""));
        rest[rest.length - 1] = chars.slice(0, -TASK_OUTPUT_MAX).join("");
      }
      break;
    }
    blocks.push(block.join("\n"));
  }
  return { blocks, truncated: rest.some((line) => line !== "") };
}

function argOrUsage(
  ctx: CommandContext,
  name: CommandName,
  args: readonly string[],
): { ref: string } | { result: CommandResult } {
  const ref = args[0];
  return ref === undefined
    ? { result: { text: render("E-ARGS", ctx.lang, { spec: specOf(name) }) } }
    : { ref };
}

const tasks: CommandHandler = async (ctx) => {
  const resolved = await liveTarget(ctx);
  if ("result" in resolved) return resolved.result;
  const { target } = resolved;
  const list = await ctx.core.runtimes.listBackgroundTasks(
    target.actor,
    target.sessionId,
  );
  return taskList(ctx, list.tasks, target.sessionId);
};

const task: CommandHandler = async (ctx, command) => {
  const arg = argOrUsage(ctx, "task", command.args);
  if ("result" in arg) return arg.result;
  const resolved = await liveTarget(ctx);
  if ("result" in resolved) return resolved.result;
  const { target } = resolved;
  const picked = await pickTask(ctx, target, arg.ref);
  if ("result" in picked) return picked.result;
  const output = await ctx.core.runtimes.readBackgroundTaskOutput(
    target.actor,
    { sessionId: target.sessionId, taskId: picked.row.id },
  );
  const { blocks, truncated } = outputBlocks(
    output.content,
    1 + TASK_MORE_PAGES,
  );
  const more = truncated || output.truncated;
  const pages = blocks.map((block, index) =>
    withFooter(
      render("R-TASK", ctx.lang, { title: picked.row.label, output: block }),
      blocks.length > 1 || more
        ? pageFooter(ctx, index, blocks.length, more)
        : "",
    ),
  );
  const [first, ...rest] = pages;
  ctx.pager.set(rest);
  return {
    text:
      first ??
      render("R-TASK", ctx.lang, { title: picked.row.label, output: "" }),
  };
};

const kill: CommandHandler = async (ctx, command) => {
  const arg = argOrUsage(ctx, "kill", command.args);
  if ("result" in arg) return arg.result;
  const resolved = await liveTarget(ctx);
  if ("result" in resolved) return resolved.result;
  const { target } = resolved;
  const picked = await pickTask(ctx, target, arg.ref);
  if ("result" in picked) return picked.result;
  const result = await ctx.core.runtimes.stopBackgroundTask(target.actor, {
    sessionId: target.sessionId,
    taskId: picked.row.id,
  });
  return {
    text: render("R-KILLED", ctx.lang, {
      title: result.task.name || picked.row.label,
    }),
  };
};

export const taskHandlers: CommandHandlers = { tasks, task, kill };
