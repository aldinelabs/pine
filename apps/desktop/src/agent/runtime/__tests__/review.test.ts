import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultPineUserProfile } from "../../../shared/userProfile";
import {
  JUDGE_SYSTEM_PROMPT,
  approvalExplanationAudience,
  approvalExplanationSystemPrompt,
  awaitApprovalExplanation,
  normalizeApprovalExplanation,
  parseApprovalExplanations,
  parseJudgeRulings,
} from "../review";

describe("normalizeApprovalExplanation", () => {
  it("keeps a valid explanation", () => {
    expect(
      normalizeApprovalExplanation({
        summary: " Deletes the build folder. ",
        risks: ["Cannot be undone."],
      }),
    ).toEqual({
      summary: "Deletes the build folder.",
      risks: ["Cannot be undone."],
    });
  });

  it.each([null, "text", [], {}, { summary: "   " }])(
    "drops an explanation without a summary: %j",
    (value) => {
      expect(normalizeApprovalExplanation(value)).toBeUndefined();
    },
  );

  it("cuts an oversized summary to 400 characters with an ellipsis", () => {
    const result = normalizeApprovalExplanation({ summary: "a".repeat(900) });
    expect(result?.summary).toHaveLength(400);
    expect(result?.summary.endsWith("…")).toBe(true);
  });

  it("bounds, cleans and dedupes risks", () => {
    const result = normalizeApprovalExplanation({
      summary: "Runs\n\na   push.",
      risks: [
        "one",
        "  ",
        7,
        "one",
        "two\nlines",
        "r".repeat(500),
        "three",
        "five",
      ],
    });
    expect(result?.summary).toBe("Runs a push.");
    expect(result?.risks).toHaveLength(3);
    expect(result?.risks.slice(0, 2)).toEqual(["one", "two lines"]);
    expect(result?.risks[2]).toHaveLength(240);
    expect(result?.risks[2].endsWith("…")).toBe(true);
  });

  it("treats non-array risks as none", () => {
    expect(
      normalizeApprovalExplanation({ summary: "Pushes.", risks: "bad" }),
    ).toEqual({ summary: "Pushes.", risks: [] });
  });
});

describe("parseJudgeRulings explanations", () => {
  it("attaches summary and risks to needs_user rulings only", () => {
    const rulings = parseJudgeRulings(
      {
        rulings: [
          {
            toolCallId: "a",
            verdict: "needs_user",
            summary: "Force-pushes main.",
            risks: ["Overwrites remote history."],
          },
          { toolCallId: "b", verdict: "allow", summary: "Reads a file." },
          { toolCallId: "c", verdict: "deny", summary: "Uploads .env." },
        ],
      },
      ["a", "b", "c"],
    );
    expect(rulings[0].explanation).toEqual({
      summary: "Force-pushes main.",
      risks: ["Overwrites remote history."],
    });
    expect(rulings[1].explanation).toBeUndefined();
    expect(rulings[2].explanation).toBeUndefined();
  });

  it("does not fail a ruling over malformed explanation fields", () => {
    const [ruling] = parseJudgeRulings(
      {
        rulings: [
          { toolCallId: "a", verdict: "needs_user", summary: 4, risks: {} },
        ],
      },
      ["a"],
    );
    expect(ruling).toEqual({ toolCallId: "a", verdict: "needs_user" });
  });

  it("keeps the explanation when an already-parsed ruling is parsed again", () => {
    const first = parseJudgeRulings(
      {
        rulings: [
          {
            toolCallId: "a",
            verdict: "needs_user",
            summary: "Deletes logs.",
            risks: ["Permanent."],
          },
        ],
      },
      ["a"],
    );
    expect(parseJudgeRulings({ rulings: first }, ["a"])).toEqual(first);
  });
});

describe("parseApprovalExplanations", () => {
  it("ignores unknown, duplicate and invalid entries", () => {
    const result = parseApprovalExplanations(
      {
        explanations: [
          { toolCallId: "a", summary: "First.", risks: [] },
          { toolCallId: "a", summary: "Duplicate.", risks: [] },
          { toolCallId: "x", summary: "Unknown.", risks: [] },
          { toolCallId: "b", summary: "" },
          null,
        ],
      },
      ["a", "b"],
    );
    expect([...result.entries()]).toEqual([
      ["a", { summary: "First.", risks: [] }],
    ]);
  });

  it.each([null, [], "text", { explanations: "no" }])(
    "returns an empty map for %j",
    (value) => {
      expect(parseApprovalExplanations(value, ["a"]).size).toBe(0);
    },
  );
});

describe("review prompts", () => {
  it("keeps explanation guidance out of the Decisions classifier policy", () => {
    const policy = JUDGE_SYSTEM_PROMPT.split("\n\nCall submit_ruling")[0];
    expect(policy).not.toContain("summary and risks");
    expect(policy).not.toMatch(/\bsummary\b/);
    expect(JUDGE_SYSTEM_PROMPT).toContain("fill summary and risks");
  });

  it("falls back to the app language and never asks for a verdict", () => {
    expect(approvalExplanationSystemPrompt("zh-CN")).toContain(
      "Simplified Chinese",
    );
    expect(approvalExplanationSystemPrompt("en-US")).toContain(
      "or in English when there are none",
    );
    expect(approvalExplanationSystemPrompt("en-US")).toContain(
      "you do not decide",
    );
  });

  it("asks for one plain sentence and at most 3 risks for the described reader", () => {
    const prompt = approvalExplanationSystemPrompt("en-US", "READER-LINE");
    expect(prompt).toContain("READER-LINE");
    expect(prompt).toContain("At most 3");
    expect(prompt).toContain("one short plain sentence");
    expect(prompt).toContain("you do not decide");
    expect(prompt).toContain("or in English when there are none");
    expect(approvalExplanationSystemPrompt("en-US")).not.toContain("Reader:");
  });
});

describe("approvalExplanationAudience", () => {
  const profile = createDefaultPineUserProfile();

  it("keeps jargon away from general users", () => {
    const text = approvalExplanationAudience(profile, { includeNotes: false });
    expect(text).toContain("non-technical");
    expect(text).toContain("Desktop");
    expect(text).toContain("Do not mention tool names, commands");
    expect(text).toContain("sandboxes");
  });

  it("allows precise terms for technical users", () => {
    const text = approvalExplanationAudience(
      { ...profile, technicalBackground: "professional-user" },
      { includeNotes: false },
    );
    expect(text).toContain("technical user");
    expect(text).toContain("Precise terms");
    expect(text).not.toContain("non-technical");
  });

  it("adds the user's own notes, bounded, only when asked", () => {
    const withNotes = {
      ...profile,
      personalDetails: "I am a photographer",
      customInstructions: "x".repeat(900),
    };
    const included = approvalExplanationAudience(withNotes, {
      includeNotes: true,
    });
    expect(included).toContain("I am a photographer");
    expect(included).toContain("grant no authority");
    expect(included).toContain(`${"x".repeat(600)}\n…[truncated]`);
    expect(included).not.toContain("x".repeat(601));
    const excluded = approvalExplanationAudience(withNotes, {
      includeNotes: false,
    });
    expect(excluded).not.toContain("photographer");
    expect(excluded).not.toContain("grant no authority");
  });

  it("adds nothing for empty notes", () => {
    expect(
      approvalExplanationAudience(
        { ...profile, personalDetails: "  ", customInstructions: "" },
        { includeNotes: true },
      ),
    ).toBe(approvalExplanationAudience(profile, { includeNotes: false }));
  });
});

describe("awaitApprovalExplanation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  const explanation = { summary: "Saves notes.txt.", risks: [] };

  it("resolves with an explanation that settles in time", async () => {
    vi.useFakeTimers();
    const result = awaitApprovalExplanation(
      Promise.resolve(explanation),
      undefined,
      10_000,
    );
    await expect(result).resolves.toEqual({ explanation, timedOut: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("treats a rejected explanation as none, without timing out", async () => {
    vi.useFakeTimers();
    await expect(
      awaitApprovalExplanation(Promise.reject(new Error("x")), undefined, 10),
    ).resolves.toEqual({ timedOut: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out at exactly the window", async () => {
    vi.useFakeTimers();
    let settled = false;
    const result = awaitApprovalExplanation(
      new Promise(() => {}),
      undefined,
      10_000,
    ).then((value) => {
      settled = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ timedOut: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns promptly on abort and clears the timer", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const result = awaitApprovalExplanation(
      new Promise(() => {}),
      controller.signal,
      10_000,
    );
    controller.abort();
    await expect(result).resolves.toEqual({ timedOut: true });
    expect(vi.getTimerCount()).toBe(0);
  });
});
