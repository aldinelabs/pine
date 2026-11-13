import { describe, expect, it } from "vitest";
import {
  JUDGE_SYSTEM_PROMPT,
  approvalExplanationSystemPrompt,
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
        "three",
        "r".repeat(500),
        "five",
      ],
    });
    expect(result?.summary).toBe("Runs a push.");
    expect(result?.risks).toHaveLength(4);
    expect(result?.risks.slice(0, 3)).toEqual(["one", "two lines", "three"]);
    expect(result?.risks[3]).toHaveLength(240);
    expect(result?.risks[3].endsWith("…")).toBe(true);
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
});
