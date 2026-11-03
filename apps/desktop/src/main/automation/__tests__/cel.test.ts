import { describe, expect, it } from "vitest";
import { checkCel, evaluatePayload, evaluateWhen } from "../cel";

const context = {
  events: [
    {
      id: "1",
      trigger: "folder",
      at: "",
      file: { path: "a/inv.pdf", name: "inv.pdf", size: 12 },
    },
    {
      id: "2",
      trigger: "folder",
      at: "",
      file: { path: "~$tmp.pdf", name: "~$tmp.pdf", size: 0 },
    },
  ],
  state: { cursor: { row: 42 } },
  now: new Date("2026-11-03T08:00:00Z"),
  automation: { id: "a", name: "Invoices" },
};

describe("automation CEL", () => {
  it("type-checks expressions against the variable table", () => {
    expect(
      checkCel("events.exists(e, e.file.size > 0)", "bool"),
    ).toBeUndefined();
    expect(checkCel("size(events)", "bool")).toMatch(/bool/);
    expect(checkCel("unknown.value")).toBeDefined();
    expect(checkCel("1 +")).toBeDefined();
  });

  it("evaluates when and payload with Pine functions", () => {
    expect(
      evaluateWhen(
        'events.exists(e, e.file.size > 0 && !e.file.name.startsWith("~$"))',
        context,
      ),
    ).toBe(true);
    expect(
      evaluatePayload(
        {
          files:
            'events.filter(e, glob(e.file.path, "**/*.pdf")).map(e, e.file.path)',
          count: "size(events)",
          month: 'formatDate(now, "yyyy-MM")',
          row: "state.cursor.row",
          label: "'报销/2026.xlsx'",
        },
        context,
      ),
    ).toEqual({
      files: ["a/inv.pdf", "~$tmp.pdf"],
      count: 2,
      month: expect.stringMatching(/^2026-11$/),
      row: 42,
      label: "报销/2026.xlsx",
    });
  });

  it("rejects non-boolean conditions and oversized expressions", () => {
    expect(() => evaluateWhen("size(events)", context)).toThrow();
    const deep = `${"(".repeat(100)}1${")".repeat(100)}`;
    expect(checkCel(deep)).toBeDefined();
  });
});
