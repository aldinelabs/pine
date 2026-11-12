import { describe, expect, it } from "vitest";
import { withoutRelayPrefix } from "../sessions";

describe("withoutRelayPrefix", () => {
  it("drops Pine's routing line before a sub-session's first message", () => {
    expect(
      withoutRelayPrefix(
        "[Sub-session of 01a1d0. Pine reports your reply.]\n\nCheck the docs",
      ),
    ).toBe("Check the docs");
    expect(
      withoutRelayPrefix('[Message from session "Plan" (p1)]\n\nStop'),
    ).toBe("Stop");
  });

  it("keeps other bracketed text", () => {
    expect(withoutRelayPrefix("[WIP] fix build")).toBe("[WIP] fix build");
  });
});
