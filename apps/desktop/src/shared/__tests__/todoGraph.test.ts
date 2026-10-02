import { describe, expect, it } from "vitest";
import { layoutTodoGraph, type Task } from "@pine/rpiv-todo";

function task(id: number, blockedBy: number[] = [], status = "pending"): Task {
  return {
    id,
    subject: `Task ${id}`,
    status: status as Task["status"],
    ...(blockedBy.length ? { blockedBy } : {}),
  };
}

function lanes(tasks: Task[]): Record<number, number> {
  return Object.fromEntries(
    layoutTodoGraph(tasks).rows.map((row) => [row.task.id, row.lane]),
  );
}

describe("layoutTodoGraph", () => {
  it("keeps independent tasks in one lane without edges", () => {
    const layout = layoutTodoGraph([task(1), task(2), task(3)]);
    expect(layout.rows.map((row) => row.task.id)).toEqual([1, 2, 3]);
    expect(layout.edges).toEqual([]);
    expect(layout.laneCount).toBe(1);
  });

  it("runs a chain straight down one lane", () => {
    const layout = layoutTodoGraph([task(1), task(2, [1]), task(3, [2])]);
    expect(lanes([task(1), task(2, [1]), task(3, [2])])).toEqual({
      1: 0,
      2: 0,
      3: 0,
    });
    expect(layout.edges).toMatchObject([
      { from: 0, to: 1, satisfied: false },
      { from: 1, to: 2, satisfied: false },
    ]);
  });

  it("branches into a second lane and merges back", () => {
    const tasks = [task(1), task(2, [1]), task(3, [1]), task(4, [2, 3])];
    const layout = layoutTodoGraph(tasks);
    // 1 fans out to 2 and 3; 4 waits for both and continues one of them.
    expect(lanes(tasks)).toEqual({ 1: 0, 2: 1, 3: 0, 4: 0 });
    expect(layout.laneCount).toBe(2);
    expect(layout.edges).toHaveLength(4);
    expect(
      layout.edges.find((edge) => edge.from === 0 && edge.to === 1),
    ).toMatchObject({ fromLane: 0, toLane: 1 });
  });

  it("never lets a lane's run pass through another node", () => {
    const tasks = [
      task(1),
      task(2, [1]),
      task(3, [1]),
      task(4, [1]),
      task(5, [2, 3, 4]),
    ];
    const layout = layoutTodoGraph(tasks);
    for (const edge of layout.edges) {
      const straight = edge.fromLane === edge.toLane;
      const runEnd = straight ? edge.to : edge.to - 1;
      for (let row = edge.from + 1; row < runEnd; row += 1) {
        expect(layout.rows[row]?.lane).not.toBe(edge.fromLane);
      }
    }
  });

  it("orders dependencies above dependants even when ids disagree", () => {
    const layout = layoutTodoGraph([task(1, [2]), task(2)]);
    expect(layout.rows.map((row) => row.task.id)).toEqual([2, 1]);
    expect(layout.edges).toMatchObject([{ from: 0, to: 1 }]);
  });

  it("marks edges from completed tasks as satisfied", () => {
    const layout = layoutTodoGraph([task(1, [], "completed"), task(2, [1])]);
    expect(layout.edges[0]?.satisfied).toBe(true);
  });

  it("ignores edges to tasks that are not shown and survives cycles", () => {
    expect(layoutTodoGraph([task(2, [1, 2])]).edges).toEqual([]);
    const cyclic = layoutTodoGraph([task(1, [2]), task(2, [1])]);
    expect(cyclic.rows).toHaveLength(2);
    expect(cyclic.edges.every((edge) => edge.from < edge.to)).toBe(true);
  });
});
