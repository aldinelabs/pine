import { describe, expect, it } from "vitest";
import type { PineMemorySummary } from "../../../shared/memory";
import { memoryNotice } from "../prompt";

function memory(
  overrides: Partial<PineMemorySummary> & { name: string },
): PineMemorySummary {
  return {
    scope: "project",
    description: `About ${overrides.name}`,
    verified: true,
    updatedAt: "2026-11-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("memoryNotice", () => {
  it("says so when nothing has been saved", () => {
    const notice = memoryNotice([]);
    expect(notice).toContain("## Long-term memory");
    expect(notice).toContain("No notes have been saved yet.");
  });

  it("lists notes by scope and marks unverified ones", () => {
    const notice = memoryNotice([
      memory({ name: "build" }),
      memory({ name: "guess", verified: false }),
      memory({ name: "tone", scope: "global" }),
    ]);
    expect(notice).toContain(
      "### Project notes\n- build: About build\n- guess (unverified): About guess",
    );
    expect(notice).toContain("### Global notes\n- tone: About tone");
  });

  it("is identical for the same notes, so an unchanged list is not re-sent", () => {
    const memories = [memory({ name: "a" }), memory({ name: "b" })];
    expect(memoryNotice(memories)).toBe(memoryNotice([...memories]));
  });

  it("counts the notes that do not fit instead of listing them", () => {
    const memories = Array.from({ length: 5 }, (_, index) =>
      memory({ name: `note-${index}` }),
    );
    const line = "- note-0: About note-0".length;
    const notice = memoryNotice(memories, line * 2);
    expect(notice).toContain("- note-1: About note-1");
    expect(notice).not.toContain("- note-2:");
    expect(notice).toContain("3 more notes are not listed here");
  });
});
