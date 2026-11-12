// @vitest-environment node
import { describe, expect, it } from "vitest";
import { HANDLE_TTL_MS, PAGER_TTL_MS } from "../constants";
import { HandleTables, Pager } from "../handles";

function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const rows = [
  { id: "s1", label: "修登录页", projectId: "p1" },
  { id: "s2", label: "调研", projectId: "p1" },
];

describe("HandleTables", () => {
  it("resolves rows 1-based and refuses out of range", () => {
    const tables = new HandleTables({ now: clock().now });
    tables.set("session", rows);
    expect(tables.resolve("session", 1)).toEqual(rows[0]);
    expect(tables.resolve("session", 2)?.id).toBe("s2");
    expect(tables.resolve("session", 0)).toBeUndefined();
    expect(tables.resolve("session", 3)).toBeUndefined();
    expect(tables.resolve("session", 1.5)).toBeUndefined();
    expect(tables.resolve("project", 1)).toBeUndefined();
  });

  it("replaces the table of one kind and keeps the others", () => {
    const tables = new HandleTables({ now: clock().now });
    tables.set("session", rows);
    tables.set("project", [{ id: "p1", label: "pine" }]);
    tables.set("session", [{ id: "s9", label: "新的" }]);
    expect(tables.resolve("session", 1)?.id).toBe("s9");
    expect(tables.resolve("session", 2)).toBeUndefined();
    expect(tables.resolve("project", 1)?.id).toBe("p1");
  });

  it("does not follow later changes to the rows it was given", () => {
    const tables = new HandleTables({ now: clock().now });
    const live = [{ id: "a", label: "A" }];
    tables.set("model", live);
    live[0] = { id: "b", label: "B" };
    expect(tables.resolve("model", 1)?.id).toBe("a");
  });

  it("expires 30 minutes after delivery", () => {
    const time = clock();
    const tables = new HandleTables({ now: time.now });
    tables.set("session", rows);
    time.advance(60_000);
    tables.noteDelivered("session", time.now());
    time.advance(HANDLE_TTL_MS);
    expect(tables.resolve("session", 1)?.id).toBe("s1");
    expect(tables.last()?.kind).toBe("session");
    time.advance(1);
    expect(tables.resolve("session", 1)).toBeUndefined();
    expect(tables.last()).toBeUndefined();
  });

  it("scopes file, task and queue tables to one session", () => {
    const tables = new HandleTables({ now: clock().now });
    tables.set("file", [{ id: "f1", label: "report.pdf" }], "s1");
    expect(tables.resolve("file", 1, "s1")?.id).toBe("f1");
    expect(tables.resolve("file", 1, "s2")).toBeUndefined();
    expect(tables.resolve("file", 1)).toBeUndefined();
    expect(() => tables.set("task", [])).toThrow();
  });

  it("names only a delivered list as the last numbered one", () => {
    const time = clock();
    const tables = new HandleTables({ now: time.now });
    tables.set("session", rows);
    expect(tables.last()).toBeUndefined();
    tables.noteDelivered("session", 5);
    expect(tables.last()).toEqual({ kind: "session", deliveredAtMs: 5 });
    tables.set("session", rows);
    expect(tables.last()).toBeUndefined();
    tables.noteDelivered("session", 6);
    tables.set("model", [{ id: "m", label: "m" }]);
    expect(tables.last()).toEqual({ kind: "session", deliveredAtMs: 6 });
    tables.noteDelivered("model", 7);
    expect(tables.last()?.kind).toBe("model");
  });

  it("persists only delivered session and project tables", () => {
    const time = clock();
    const tables = new HandleTables({ now: time.now });
    tables.set("session", rows);
    tables.set("project", [{ id: "p1", label: "pine" }]);
    tables.set("model", [{ id: "m", label: "m" }]);
    tables.noteDelivered("session", time.now());
    tables.noteDelivered("model", time.now());
    const snapshot = tables.snapshot();
    expect(Object.keys(snapshot)).toEqual(["session"]);
    expect(snapshot.session?.rows).toEqual(rows);

    const restored = new HandleTables({ now: time.now });
    restored.restore(snapshot);
    expect(restored.resolve("session", 2)?.id).toBe("s2");
    expect(restored.last()).toBeUndefined();

    time.advance(HANDLE_TTL_MS + 1);
    const late = new HandleTables({ now: time.now });
    late.restore(snapshot);
    expect(late.resolve("session", 1)).toBeUndefined();
    late.restore(undefined);
  });

  it("clears one kind or everything", () => {
    const tables = new HandleTables({ now: clock().now });
    tables.set("session", rows);
    tables.set("project", [{ id: "p1", label: "pine" }]);
    tables.noteDelivered("session", 1);
    tables.clear("session");
    expect(tables.resolve("session", 1)).toBeUndefined();
    expect(tables.last()).toBeUndefined();
    expect(tables.table("project")?.rows).toHaveLength(1);
    tables.clear();
    expect(tables.table("project")).toBeUndefined();
  });
});

describe("Pager", () => {
  it("returns the pages in order, then nothing", () => {
    const pager = new Pager({ now: clock().now });
    pager.set(["two", { text: "three", list: { kind: "session", rows } }]);
    expect(pager.remaining()).toBe(2);
    expect(pager.next()).toEqual({ text: "two" });
    expect(pager.next()?.list?.kind).toBe("session");
    expect(pager.next()).toBeUndefined();
    expect(pager.remaining()).toBe(0);
  });

  it("replaces the cursor on set and expires after PAGER_TTL_MS idle", () => {
    const time = clock();
    const pager = new Pager({ now: time.now });
    pager.set(["a", "b", "c"]);
    pager.set(["x", "y"]);
    time.advance(PAGER_TTL_MS);
    expect(pager.next()?.text).toBe("x");
    time.advance(PAGER_TTL_MS + 1);
    expect(pager.next()).toBeUndefined();
    expect(pager.remaining()).toBe(0);
  });

  it("clears", () => {
    const pager = new Pager({ now: clock().now });
    pager.set(["a"]);
    pager.clear();
    expect(pager.next()).toBeUndefined();
  });
});
