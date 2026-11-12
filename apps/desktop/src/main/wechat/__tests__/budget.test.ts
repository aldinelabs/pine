// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  allows,
  budgetNoticeDue,
  enqueue,
  planMerge,
  remainingSends,
  withoutKey,
} from "../budget";
import { USABLE } from "../constants";
import type { QueuedOutbound } from "../types";

function token(sent: number) {
  return { value: "t", receivedAtMs: 0, sent, budgetNoticeSent: false };
}

function item(
  key: string,
  priority: QueuedOutbound["priority"],
  queuedAtMs = 0,
): QueuedOutbound {
  return { key, priority, queuedAtMs, digest: { kind: "done", title: key } };
}

describe("remainingSends", () => {
  it("counts down from USABLE and never below zero", () => {
    expect(remainingSends(undefined)).toBe(0);
    expect(remainingSends(token(0))).toBe(USABLE);
    expect(remainingSends(token(USABLE - 1))).toBe(1);
    expect(remainingSends(token(USABLE + 3))).toBe(0);
  });
});

describe("allows", () => {
  it.each([
    [0, 1, true],
    [0, 0, false],
    [1, 2, true],
    [1, 1, false],
    [2, 2, true],
    [2, 1, false],
    [3, 5, true],
    [3, 4, false],
    [4, 4, true],
    [4, 3, false],
  ] as const)("P%i with %i left: %s", (priority, remaining, expected) => {
    expect(allows(priority, remaining)).toBe(expected);
  });
});

describe("budgetNoticeDue", () => {
  it("is due on the last slot, once", () => {
    expect(budgetNoticeDue(1, false)).toBe(true);
    expect(budgetNoticeDue(1, true)).toBe(false);
    expect(budgetNoticeDue(2, false)).toBe(false);
    expect(budgetNoticeDue(0, false)).toBe(false);
  });
});

describe("enqueue", () => {
  it("keeps the latest result per session and drops its progress", () => {
    let queue = enqueue([], item("progress:s1", 3));
    queue = enqueue(queue, item("result:s1", 2, 1));
    queue = enqueue(queue, item("result:s1", 2, 2));
    expect(queue.map((q) => [q.key, q.queuedAtMs])).toEqual([["result:s1", 2]]);
    queue = enqueue(queue, item("progress:s1", 3, 3));
    expect(queue.map((q) => q.key)).toEqual(["result:s1"]);
    queue = enqueue(queue, item("progress:s2", 3, 4));
    expect(queue.map((q) => q.key)).toEqual(["result:s1", "progress:s2"]);
  });

  it("drops a decided card", () => {
    const queue = enqueue(enqueue([], item("ask:12", 1)), item("ask:13", 1));
    expect(withoutKey(queue, "ask:12").map((q) => q.key)).toEqual(["ask:13"]);
  });

  it("is bounded by dropping the least important, oldest first", () => {
    let queue: QueuedOutbound[] = [];
    queue = enqueue(queue, item("ask:11", 1, 0), 3);
    queue = enqueue(queue, item("autorun:a", 4, 1), 3);
    queue = enqueue(queue, item("autorun:b", 4, 2), 3);
    queue = enqueue(queue, item("result:s", 2, 3), 3);
    expect(queue.map((q) => q.key)).toEqual([
      "ask:11",
      "autorun:b",
      "result:s",
    ]);
    queue = enqueue(queue, item("ask:12", 1, 4), 3);
    expect(queue.map((q) => q.key)).toEqual(["ask:11", "result:s", "ask:12"]);
  });

  it("does not change its input", () => {
    const queue = [item("ask:11", 1)];
    enqueue(queue, item("ask:12", 1));
    expect(queue).toHaveLength(1);
  });
});

describe("planMerge", () => {
  it("merges up to three cards with the results, the rest overflow", () => {
    const plan = planMerge([
      { key: "ask:11", priority: 1 },
      { key: "result:s", priority: 2 },
      { key: "ask:12", priority: 1 },
      { key: "progress:t", priority: 3 },
      { key: "ask:13", priority: 1 },
      { key: "ask:14", priority: 1 },
      { key: "auto-on:a", priority: 4 },
    ] as const);
    expect(plan.merged.map((p) => p.key)).toEqual([
      "ask:11",
      "ask:12",
      "ask:13",
      "result:s",
    ]);
    expect(plan.overflow.map((p) => p.key)).toEqual(["ask:14"]);
    expect(plan.single.map((p) => p.key)).toEqual(["progress:t", "auto-on:a"]);
  });
});
