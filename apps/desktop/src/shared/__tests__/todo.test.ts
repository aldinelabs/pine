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

/** A fresh list; a list starts with at least two steps. */
function withTasks(...subjects: string[]): TaskState {
  return run(emptyTaskState(), "create", {
    tasks: subjects.map((subject) => ({ subject, dependsOn: [] })),
  }).state;
}

describe("todo reducer", () => {
  it("creates a whole list in one call with in-batch dependencies", () => {
    const created = run(emptyTaskState(), "create", {
      tasks: [
        {
          subject: "Locate the parser",
          status: "in_progress",
          activeForm: "locating the parser",
          dependsOn: [],
        },
        { subject: "Write the parser", dependsOn: [1] },
        { subject: "Write docs", dependsOn: [1] },
        { subject: "Run checks", dependsOn: [2, 3] },
      ],
    });
    expect(created.text).toBe(
      [
        "Created 4 tasks:",
        "[in_progress] #1 Locate the parser (locating the parser)",
        "[pending] #2 Write the parser ⛓ #1",
        "[pending] #3 Write docs ⛓ #1",
        "[pending] #4 Run checks ⛓ #2,#3",
      ].join("\n"),
    );
    expect(created.state.nextId).toBe(5);

    // Steps added later reference existing ids and continue the numbering.
    const appended = run(created.state, "create", {
      tasks: [
        { subject: "Fix review notes", dependsOn: [], blockedBy: [4] },
        { subject: "Recheck", dependsOn: [1] },
      ],
    });
    expect(appended.state.tasks.slice(4)).toEqual([
      { id: 5, subject: "Fix review notes", status: "pending", blockedBy: [4] },
      { id: 6, subject: "Recheck", status: "pending", blockedBy: [5] },
    ]);
  });

  it("rejects malformed batches without changing anything", () => {
    const state = emptyTaskState();
    const create = (params: TaskMutationParams) =>
      run(state, "create", params).text;
    expect(create({ tasks: [] })).toBe(
      "Error: tasks must contain at least one step",
    );
    expect(
      create({
        tasks: [
          { subject: "A", dependsOn: [] },
          { subject: "B", dependsOn: [2] },
        ],
      }),
    ).toBe("Error: tasks[2]: dependsOn: 2 is not an earlier step (use 1 to 1)");
    expect(
      create({ tasks: [{ subject: "A" }, { subject: "B", dependsOn: [] }] }),
    ).toBe(
      "Error: tasks[1]: dependsOn required: list the positions of earlier steps it needs, or [] when it depends on none",
    );
    expect(
      create({
        tasks: [
          { subject: "A", dependsOn: [] },
          { subject: "B", status: "completed", dependsOn: [] },
        ],
      }),
    ).toBe(
      "Error: tasks[2]: a new task starts as pending or in_progress, not completed",
    );
    expect(create({ subject: "A", tasks: [] })).toBe(
      "Error: create takes either subject (one task) or tasks (a list), not both",
    );
  });

  it("never starts a list with a single step", () => {
    const single =
      "Error: a new todo list needs at least 2 steps: pass every step in tasks, or skip the list for single-step work";
    expect(
      run(emptyTaskState(), "create", { subject: "A", blockedBy: [] }).text,
    ).toBe(single);
    expect(
      run(emptyTaskState(), "create", {
        tasks: [{ subject: "A", dependsOn: [] }],
      }).text,
    ).toBe(single);

    // A finished list does not count as one under way.
    let state = withTasks("A", "B");
    state = run(state, "update", { id: 1, status: "completed" }).state;
    const added = run(state, "create", {
      subject: "C",
      status: "in_progress",
      blockedBy: [1],
    });
    expect(added.text).toBe("Created #3: C (in_progress)");
    state = run(added.state, "update", { id: 2, status: "completed" }).state;
    state = run(state, "update", { id: 3, status: "completed" }).state;
    expect(run(state, "create", { subject: "D", blockedBy: [] }).text).toBe(
      single,
    );
  });

  it("validates single-task creates", () => {
    const state = withTasks("A", "B");
    expect(run(state, "create", { subject: "  " }).text).toBe(
      "Error: subject required for create",
    );
    // Every task states its dependencies, even when it has none.
    expect(run(state, "create", { subject: "C" }).text).toBe(
      "Error: blockedBy required for create: list the ids this task depends on, or [] when it depends on none",
    );
  });

  it("follows the status machine and reports no-op updates", () => {
    let state = withTasks("A", "B");
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
    let state = run(withTasks("X", "Y"), "create", {
      subject: "A",
      blockedBy: [],
      metadata: { area: "ui", size: 2 },
    }).state;
    state = run(state, "update", {
      id: 3,
      metadata: { area: null, owner: "pine" },
    }).state;
    expect(state.tasks[2]?.metadata).toEqual({ size: 2, owner: "pine" });
    state = run(state, "update", {
      id: 3,
      metadata: { size: null, owner: null },
    }).state;
    expect(state.tasks[2]).not.toHaveProperty("metadata");
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
    const state = withTasks("A", "B");
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
      nextId: 3,
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
    state = run(state, "create", { subject: "F", blockedBy: [] }).state;

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
    state = run(state, "create", { subject: "C", blockedBy: [] }).state;
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
