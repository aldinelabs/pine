import { describe, expect, it } from "vitest";
import { errorReason } from "../errorHandler";

describe("errorReason", () => {
  it("drops Electron's wrapper around a main-process rejection", () => {
    expect(
      errorReason(
        new Error(
          "Error invoking remote method 'pine:live-context:start': Error: Live Context is already capturing a conversation.",
        ),
      ),
    ).toBe("Live Context is already capturing a conversation.");
  });

  it("keeps a renderer error's own message", () => {
    expect(errorReason(new Error("An object could not be cloned."))).toBe(
      "An object could not be cloned.",
    );
    expect(errorReason("Plain text")).toBe("Plain text");
  });

  it("has nothing to say for an empty or unknown error", () => {
    expect(errorReason(new Error(""))).toBeUndefined();
    expect(errorReason({ code: 1 })).toBeUndefined();
  });
});
