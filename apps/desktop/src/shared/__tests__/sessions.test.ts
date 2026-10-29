import { describe, expect, it } from "vitest";
import { parseMessageBlocks } from "../sessions";

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
