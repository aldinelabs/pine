import { describe, expect, it } from "vitest";
import {
  applyTaskMutation,
  buildTodoToolResult,
  emptyTaskState,
  replayTodoState,
  sanitizeTaskText,
  selectOverlayLayout,
  selectShowTaskIds,
  selectTodoCounts,
  TODO_TOOL_NAME,
  type TaskAction,
  type TaskMutationParams,
  type TaskState,
} from "@pine/rpiv-todo";

function run(
  state: TaskState,
  action: TaskAction,
  params: TaskMutationParams = {},
) {
  const result = applyTaskMutation(state, action, params);
  return {
    ...result,
    text: buildTodoToolResult(action, params, result.state, result.op)
      .content[0].text,
  };
}

function withTasks(...subjects: string[]): TaskState {
  return subjects.reduce(
    (state, subject) => run(state, "create", { subject }).state,
    emptyTaskState(),
  );
}

describe("todo reducer", () => {
  it("creates pending tasks with sequential ids", () => {
    const created = run(emptyTaskState(), "create", {
      subject: "Write the parser",
    });
    expect(created.text).toBe("Created #1: Write the parser (pending)");
    expect(created.state).toEqual({
      tasks: [{ id: 1, subject: "Write the parser", status: "pending" }],
      nextId: 2,
    });
    expect(run(emptyTaskState(), "create", { subject: "  " }).text).toBe(
      "Error: subject required for create",
    );
  });

  it("follows the status machine and reports no-op updates", () => {
    let state = withTasks("A");
    const started = run(state, "update", { id: 1, status: "in_progress" });
    expect(started.text).toBe("Updated #1 (pending → in_progress)");
    state = started.state;
    expect(run(state, "update", { id: 1, status: "in_progress" }).text).toBe(
      "No change: #1 already matches the requested values (status: in_progress)",
    );
    state = run(state, "update", { id: 1, status: "completed" }).state;
    const reopened = run(state, "update", { id: 1, status: "in_progress" });
    expect(reopened.text).toBe(
      "Error: illegal transition completed → in_progress",
    );
    expect(reopened.state).toBe(state);
    expect(run(state, "update", { id: 1 }).text).toMatch(
      /^Error: update requires at least one mutable field/,
    );
  });

  it("validates dependencies before mutating", () => {
    let state = withTasks("A", "B");
    expect(run(state, "create", { subject: "C", blockedBy: [9] }).text).toBe(
      "Error: blockedBy: #9 not found",
    );
    expect(run(state, "update", { id: 1, addBlockedBy: [1] }).text).toBe(
      "Error: cannot block #1 on itself",
    );
    state = run(state, "update", { id: 2, addBlockedBy: [1] }).state;
    expect(run(state, "update", { id: 1, addBlockedBy: [2] }).text).toBe(
      "Error: addBlockedBy would create a cycle in the blockedBy graph",
    );
    state = run(state, "delete", { id: 1 }).state;
    expect(run(state, "create", { subject: "C", blockedBy: [1] }).text).toBe(
      "Error: blockedBy: #1 is deleted",
    );
    expect(run(state, "get", { id: 1 }).text).toBe(
      "#1 [deleted] A\n  blocks: #2",
    );
  });

  it("merges metadata and deletes null keys", () => {
    let state = run(emptyTaskState(), "create", {
      subject: "A",
      metadata: { area: "ui", size: 2 },
    }).state;
    state = run(state, "update", {
      id: 1,
      metadata: { area: null, owner: "pine" },
    }).state;
    expect(state.tasks[0]?.metadata).toEqual({ size: 2, owner: "pine" });
    state = run(state, "update", {
      id: 1,
      metadata: { size: null, owner: null },
    }).state;
    expect(state.tasks[0]).not.toHaveProperty("metadata");
  });

  it("lists, deletes, and clears with upstream wording", () => {
    let state = withTasks("A", "B");
    state = run(state, "update", {
      id: 2,
      status: "in_progress",
      activeForm: "writing B",
      addBlockedBy: [1],
    }).state;
    expect(run(state, "list").text).toBe(
      "[pending] #1 A\n[in_progress] #2 B (writing B) ⛓ #1",
    );
    expect(run(state, "delete", { id: 1 }).text).toBe("Deleted #1: A");
    expect(run(state, "clear").text).toBe("Cleared 2 tasks");
    expect(run(state, "clear").state).toEqual(emptyTaskState());
    expect(run(emptyTaskState(), "list").text).toBe("No tasks");
  });

  it("keeps a full snapshot on rejected calls", () => {
    const state = withTasks("A");
    const result = buildTodoToolResult(
      "update",
      { id: 4 },
      state,
      applyTaskMutation(state, "update", { id: 4, status: "completed" }).op,
    );
    expect(result.details).toEqual({
      action: "update",
      params: { id: 4 },
      tasks: state.tasks,
      nextId: 2,
      error: "#4 not found",
    });
  });
});

describe("todo replay and layout", () => {
  it("replays the last todo snapshot from the branch", () => {
    const snapshot = withTasks("A", "B");
    const entries = [
      { type: "message", message: { role: "user", content: "hi" } },
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: TODO_TOOL_NAME,
          details: { tasks: [], nextId: 7 },
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: TODO_TOOL_NAME,
          details: { action: "create", params: {}, ...snapshot },
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "read",
          details: { tasks: [], nextId: 1 },
        },
      },
      {
        type: "message",
        message: { role: "toolResult", toolName: TODO_TOOL_NAME },
      },
    ];
    const replayed = replayTodoState(entries);
    expect(replayed).toEqual(snapshot);
    expect(replayed.tasks[0]).not.toBe(snapshot.tasks[0]);
    expect(replayTodoState([])).toEqual(emptyTaskState());
  });

  it("drops completed rows first, then truncates unfinished work", () => {
    let state = withTasks("A", "B", "C", "D", "E");
    state = run(state, "update", { id: 1, status: "completed" }).state;
    state = run(state, "update", { id: 2, status: "completed" }).state;

    expect(selectOverlayLayout(state, 5).visible).toHaveLength(5);

    const withoutCompleted = selectOverlayLayout(state, 4);
    expect(withoutCompleted.visible.map((task) => task.id)).toEqual([3, 4, 5]);
    expect(withoutCompleted).toMatchObject({
      hiddenCompleted: 2,
      truncatedTail: 0,
    });

    state = run(state, "update", { id: 3, status: "completed" }).state;
    const oldestCompletedKept = selectOverlayLayout(state, 4);
    expect(oldestCompletedKept.visible.map((task) => task.id)).toEqual([
      1, 4, 5,
    ]);
    expect(oldestCompletedKept.hiddenCompleted).toBe(2);
    state = run(state, "create", { subject: "F" }).state;

    const truncated = selectOverlayLayout(state, 3);
    expect(truncated.visible.map((task) => task.id)).toEqual([4, 5]);
    expect(truncated).toMatchObject({ hiddenCompleted: 3, truncatedTail: 1 });
  });

  it("counts visible tasks and shows ids only with dependencies", () => {
    let state = withTasks("A", "B");
    expect(selectShowTaskIds(state)).toBe(false);
    state = run(state, "update", { id: 2, addBlockedBy: [1] }).state;
    state = run(state, "update", { id: 1, status: "completed" }).state;
    expect(selectShowTaskIds(state)).toBe(true);
    state = run(state, "create", { subject: "C" }).state;
    state = run(state, "delete", { id: 3 }).state;
    expect(selectTodoCounts(state)).toEqual({
      total: 2,
      pending: 1,
      inProgress: 0,
      completed: 1,
    });
  });

  it("removes control and bidi characters from task text", () => {
    expect(sanitizeTaskText("a\u001b[31mred\u001b[0m\nnext‮txt")).toBe(
      "ared nexttxt",
    );
  });
});
