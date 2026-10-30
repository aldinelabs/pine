import type {
  ExtensionAPI,
  ExtensionContext,
  ToolResultEvent,
  ToolResultEventResult,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { Task } from "@pine/rpiv-todo";
import {
  buildProgressReminder,
  createProgressRemindersExtension,
  TODO_REMINDER_TURN_INTERVAL,
} from "../progress-reminders";

const ACTIVE_TASKS: Task[] = [
  { id: 1, subject: "Locate the handler", status: "completed" },
  { id: 2, subject: "Change the handler", status: "pending", blockedBy: [1] },
  { id: 3, subject: "Run checks", status: "pending", blockedBy: [2] },
];

function todoEntry(tasks: Task[]) {
  return {
    type: "message",
    message: {
      role: "toolResult",
      toolName: "todo",
      details: { action: "update", params: {}, tasks, nextId: 4 },
    },
  };
}

function setup(tasks: Task[] = ACTIVE_TASKS) {
  const handlers = new Map<string, unknown>();
  const activeTools = ["read", "todo"];
  const pi = {
    on: (name: string, handler: unknown) => handlers.set(name, handler),
    getActiveTools: () => activeTools,
  } as unknown as ExtensionAPI;
  const extension = createProgressRemindersExtension();
  if (typeof extension !== "object" || !("factory" in extension))
    throw new Error("Expected an inline extension");
  void extension.factory(pi);
  const start = handlers.get("turn_start") as () => void;
  const handler = handlers.get("tool_result") as (
    event: ToolResultEvent,
    ctx: ExtensionContext,
  ) => ToolResultEventResult | undefined;
  const branch: unknown[] = [todoEntry(tasks)];
  const ctx = {
    sessionManager: { getBranch: () => branch },
  } as unknown as ExtensionContext;
  const result = (event: ToolResultEvent) => handler(event, ctx);
  const turn = (count = 1) => {
    for (let index = 0; index < count; index += 1) start();
  };
  const tool = (overrides: Partial<ToolResultEvent> = {}) =>
    result({
      type: "tool_result",
      toolName: "read",
      toolCallId: "call",
      input: {},
      content: [{ type: "text", text: "original output" }],
      details: undefined,
      isError: false,
      ...overrides,
    });
  return { turn, tool, activeTools, branch };
}

describe("progress reminders", () => {
  it("counts model turns, not tool calls, and adds one reminder per interval", () => {
    const { turn, tool } = setup();
    turn(15);
    for (let index = 0; index < 20; index += 1) expect(tool()).toBeUndefined();
    turn();
    expect(tool()?.content?.at(-1)).toEqual({
      type: "text",
      text: `\n\n${buildProgressReminder({ tasks: ACTIVE_TASKS, nextId: 4 })}`,
    });
    // Other completions in the same parallel batch do not repeat it.
    expect(tool()).toBeUndefined();
    turn(15);
    expect(tool()).toBeUndefined();
    turn();
    expect(tool()?.content).toHaveLength(2);
  });

  it("resets after successful todo use, including nested todo calls", () => {
    const { turn, tool } = setup();
    turn(TODO_REMINDER_TURN_INTERVAL);
    expect(
      tool({
        toolName: "todo",
        parentToolCallId: "outer",
        details: { tasks: [] },
      }),
    ).toBeUndefined();
    expect(tool()).toBeUndefined();
    turn(TODO_REMINDER_TURN_INTERVAL);
    expect(tool()?.content).toHaveLength(2);
  });

  it("does not treat failed todo updates as a completed progress review", () => {
    const { turn, tool } = setup();
    turn(TODO_REMINDER_TURN_INTERVAL);
    tool({ toolName: "todo", isError: true });
    tool({ toolName: "todo", details: { error: "unknown task" } });
    expect(tool()?.content).toHaveLength(2);
  });

  it("preserves images and structured output without rewriting result metadata", () => {
    const { turn, tool } = setup();
    turn(TODO_REMINDER_TURN_INTERVAL);
    const content = [
      { type: "image" as const, mimeType: "image/png", data: "image-data" },
      { type: "text" as const, text: "diagnostic output" },
    ];
    const patched = tool({
      content,
      structuredContent: { count: 3 },
      isError: true,
      details: { original: true },
    });
    expect(patched?.content?.slice(0, 2)).toEqual(content);
    expect(patched?.structuredContent).toEqual({ count: 3 });
    expect(patched).not.toHaveProperty("isError");
    expect(patched).not.toHaveProperty("details");
    expect(content).toHaveLength(2);
  });

  it("waits for an outer result and skips reminders while todo is unavailable", () => {
    const { turn, tool, activeTools } = setup();
    turn(TODO_REMINDER_TURN_INTERVAL);
    expect(tool({ parentToolCallId: "script" })).toBeUndefined();
    activeTools.pop();
    expect(tool()).toBeUndefined();
    activeTools.push("todo");
    expect(tool()?.content).toHaveLength(2);
  });

  it("keeps cadence isolated between sessions", () => {
    const first = setup();
    const second = setup();
    first.turn(TODO_REMINDER_TURN_INTERVAL);
    second.turn();
    expect(first.tool()?.content).toHaveLength(2);
    expect(second.tool()).toBeUndefined();
  });

  it("stays silent without unfinished work and waits a full interval", () => {
    const { turn, tool, branch } = setup([]);
    turn(TODO_REMINDER_TURN_INTERVAL);
    expect(tool()).toBeUndefined();
    branch.push(todoEntry(ACTIVE_TASKS));
    expect(tool()).toBeUndefined();
    turn(TODO_REMINDER_TURN_INTERVAL);
    expect(tool()?.content).toHaveLength(2);

    const done = ACTIVE_TASKS.map((task) => ({
      ...task,
      status: "completed" as const,
    }));
    expect(buildProgressReminder({ tasks: done, nextId: 4 })).toBeUndefined();
  });

  it("names the ready steps when nothing is in progress", () => {
    const text = buildProgressReminder({ tasks: ACTIVE_TASKS, nextId: 4 });
    expect(text).toContain("Current todo list (1/3 completed):");
    expect(text).toContain("[pending] #2 Change the handler ⛓ #1");
    expect(text).not.toContain("Locate the handler");
    expect(text).toContain("No task is in_progress");
    expect(text).toContain("(ready now: #2)");
  });

  it("asks whether the in-progress step is finished", () => {
    const tasks = ACTIVE_TASKS.map((task) =>
      task.id === 2 ? { ...task, status: "in_progress" as const } : task,
    );
    const text = buildProgressReminder({ tasks, nextId: 4 });
    expect(text).toContain("If #2 is finished and verified, mark it completed");
    expect(text).not.toContain("No task is in_progress");
  });
});
