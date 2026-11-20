import { describe, expect, it } from "vitest";
import type { PineMemorySummary } from "../../../shared/memory";
import { MEMORY_SYSTEM_PROMPT, memoryNotice } from "../prompt";

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
    expect(memoryNotice([])).toBe("No notes have been saved yet.");
  });

  it("carries only the note list; the guide is a system prompt section", () => {
    const notice = memoryNotice([memory({ name: "build" })]);
    expect(notice).not.toContain("## Long-term memory");
    expect(MEMORY_SYSTEM_PROMPT).toMatch(/^## Long-term memory\n/);
    expect(MEMORY_SYSTEM_PROMPT).toContain(
      "Pine's memory notice lists each note's name",
    );
  });
});

describe("MEMORY_SYSTEM_PROMPT", () => {
  it("sets a bar for what to save, generalized beyond the project", () => {
    const notice = MEMORY_SYSTEM_PROMPT;
    expect(notice).toContain("a future, different conversation will need it");
    expect(notice).toContain(
      "each note is a prediction that it will matter again",
    );
    expect(notice).toContain("In No Project");
    expect(notice).toContain("when in doubt, skip it or ask the user");
    expect(notice).toContain("Project notes hold what will matter again");
    expect(notice).toContain(
      'global note local-debug-environment ("本机调试环境要点记录"), not wechat-debug-pitfalls',
    );
    expect(notice).toContain("instead of adding a near-duplicate");
  });
});

describe("memoryNotice lists", () => {
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
