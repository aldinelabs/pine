import { describe, expect, it } from "vitest";
import {
  parseContentBlocks,
  parseMessageBlocks,
  progressReportText,
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
