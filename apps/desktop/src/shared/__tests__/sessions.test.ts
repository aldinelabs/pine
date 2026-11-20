import { describe, expect, it } from "vitest";
import {
  parseContentBlocks,
  parseMessageBlocks,
  PINE_REPLY_SUGGESTION_ENTRY,
  progressReportText,
  normalizeKeptReplySuggestion,
  replySuggestionEntryData,
  replySuggestionField,
  replySuggestionFromBranch,
} from "../sessions";

describe("parseMessageBlocks", () => {
  it("shows a user stop as stopped rather than an error", () => {
    expect(
      parseMessageBlocks({
        role: "assistant",
        content: [],
        stopReason: "aborted",
        errorMessage: "Request was aborted",
      }),
    ).toEqual([{ type: "stopped" }]);
    expect(
      parseMessageBlocks({
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "This operation was aborted",
      }),
    ).toEqual([{ type: "stopped" }]);
  });

  it("keeps other request failures as errors", () => {
    expect(
      parseMessageBlocks({
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "The operation was aborted due to timeout",
      }),
    ).toEqual([
      {
        type: "error",
        error: { message: "The operation was aborted due to timeout" },
      },
    ]);
  });
});

describe("progress reports", () => {
  it("reads the report text of a report_progress call only", () => {
    expect(progressReportText("bash", { content: "ls" })).toBeUndefined();
    expect(progressReportText(undefined, { content: "x" })).toBeUndefined();
    // Transcripts from before the rename keep the old name.
    expect(progressReportText("ui_report_progress", { content: "Old." })).toBe(
      "Old.",
    );
    expect(
      progressReportText("report_progress", { content: "**Likely** yes." }),
    ).toBe("**Likely** yes.");
    expect(progressReportText("report_progress", undefined)).toBe("");
    expect(progressReportText("report_progress", {})).toBe("");
    expect(progressReportText("report_progress", { content: 3 })).toBe("");
    expect(progressReportText("report_progress", ["text"])).toBe("");
  });

  it("parses a report as reply text at the same content index", () => {
    expect(
      parseContentBlocks([
        { type: "thinking", thinking: "Answer first, then check." },
        {
          type: "toolCall",
          id: "call-report",
          name: "report_progress",
          arguments: { content: "Probably the cache." },
        },
        {
          type: "toolCall",
          id: "call-read",
          name: "read",
          arguments: { path: "/project/cache.ts" },
        },
      ]),
    ).toEqual([
      { type: "thinking", thinking: "Answer first, then check." },
      { type: "text", text: "Probably the cache." },
      {
        type: "toolCall",
        toolCall: {
          id: "call-read",
          name: "read",
          status: "pending",
          input: { path: "/project/cache.ts" },
        },
      },
    ]);
  });

  it("keeps a block for a report without usable content", () => {
    expect(
      parseContentBlocks([
        { type: "toolCall", id: "call-report", name: "report_progress" },
        { type: "text", text: "Final answer." },
      ]),
    ).toEqual([
      { type: "text", text: "" },
      { type: "text", text: "Final answer." },
    ]);
  });

  it("keeps a partial report when the run is stopped", () => {
    expect(
      parseMessageBlocks({
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call-report",
            name: "report_progress",
            arguments: { content: "Probably the ca" },
          },
        ],
        stopReason: "aborted",
        errorMessage: "Request was aborted",
      }),
    ).toEqual([{ type: "text", text: "Probably the ca" }, { type: "stopped" }]);
  });
});

describe("reply suggestion entries", () => {
  const user = (id: string) => ({
    type: "message",
    id,
    message: { role: "user" },
  });
  const assistant = (id: string) => ({
    type: "message",
    id,
    message: { role: "assistant" },
  });
  // An entry as Pine writes it now, or as older versions wrote it (text only).
  const kept = (
    alternatives: string[] | null,
    index = 0,
    messageId?: string,
  ) => ({
    type: "custom",
    id: `s-${alternatives?.join()}`,
    customType: PINE_REPLY_SUGGESTION_ENTRY,
    data: alternatives
      ? { text: alternatives[index], alternatives, index, messageId }
      : { text: null },
  });
  const legacy = (text: string, messageId: string) => ({
    type: "custom",
    id: "legacy",
    customType: PINE_REPLY_SUGGESTION_ENTRY,
    data: { text, messageId },
  });
  const three = { alternatives: ["继续", "换个思路", "先解释"], index: 1 };

  it("keeps every alternative and the shown one for the last assistant message", () => {
    const branch = [user("u1"), assistant("a1")];
    expect(replySuggestionEntryData(branch, three)).toEqual({
      text: "换个思路",
      alternatives: ["继续", "换个思路", "先解释"],
      index: 1,
      messageId: "a1",
    });
    const withKept = [
      ...branch,
      { type: "custom", id: "t", customType: "pine.approval-mode", data: {} },
      kept(three.alternatives, 1, "a1"),
      { type: "custom_message", id: "n" },
    ];
    expect(replySuggestionFromBranch(withKept)).toEqual(three);
    expect(replySuggestionField(withKept)).toEqual({ replySuggestion: three });
    // Writing the same set again is a no-op; another shown one is not.
    expect(replySuggestionEntryData(withKept, three)).toBeUndefined();
    expect(
      replySuggestionEntryData(withKept, { ...three, index: 2 }),
    ).toMatchObject({ text: "先解释", index: 2 });
  });

  it("reads a single suggestion written before alternatives existed", () => {
    expect(
      replySuggestionFromBranch([
        user("u1"),
        assistant("a1"),
        legacy("继续", "a1"),
      ]),
    ).toEqual({ alternatives: ["继续"], index: 0 });
  });

  it("cleans up what it keeps", () => {
    expect(
      normalizeKeptReplySuggestion({
        alternatives: ["a", " ", "a", "b"],
        index: 9,
      }),
    ).toEqual({ alternatives: ["a", "b"], index: 1 });
    expect(
      normalizeKeptReplySuggestion({ alternatives: [" "], index: 0 }),
    ).toBeUndefined();
  });

  it("drops them once used, sent past, answered again, rewound or compacted", () => {
    const base = [user("u1"), assistant("a1"), kept(["继续"], 0, "a1")];
    expect(replySuggestionFromBranch([...base, kept(null)])).toBeUndefined();
    expect(replySuggestionFromBranch([...base, user("u2")])).toBeUndefined();
    expect(
      replySuggestionFromBranch([...base, user("u2"), assistant("a2")]),
    ).toBeUndefined();
    expect(
      replySuggestionFromBranch([...base, { type: "compaction", id: "c" }]),
    ).toBeUndefined();
    expect(
      replySuggestionFromBranch([...base, { type: "context_edit", id: "e" }]),
    ).toBeUndefined();
    // Rewound to the user message: the kept entry is off the branch.
    expect(replySuggestionFromBranch([user("u1")])).toBeUndefined();
    // Written after the user had already sent the next message, it names an
    // older assistant message and does not count.
    expect(
      replySuggestionFromBranch([
        user("u1"),
        assistant("a1"),
        user("u2"),
        kept(["继续"], 0, "a1"),
      ]),
    ).toBeUndefined();
    expect(replySuggestionField([...base, kept(null)])).toEqual({});
  });

  it("writes nothing unless the branch ends with an assistant message", () => {
    expect(replySuggestionEntryData([user("u1")], three)).toBeUndefined();
    expect(replySuggestionEntryData([], three)).toBeUndefined();
    expect(
      replySuggestionEntryData([user("u1"), assistant("a1")], null),
    ).toBeUndefined();
    expect(
      replySuggestionEntryData(
        [user("u1"), assistant("a1"), legacy("继续", "a1")],
        null,
      ),
    ).toEqual({ text: null });
  });
});
