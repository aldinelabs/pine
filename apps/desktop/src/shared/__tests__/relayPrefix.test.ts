import { describe, expect, it } from "vitest";
import { parseRelayPrefix, relayTitle, withoutRelayPrefix } from "../sessions";

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

describe("parseRelayPrefix", () => {
  it("names the parent that started a sub-session", () => {
    expect(
      parseRelayPrefix("[Sub-session of 01a1-d0. Pine reports back.]\n\nGo"),
    ).toEqual({ source: { kind: "parent", sessionId: "01a1-d0" }, body: "Go" });
  });

  it("names the session a message came from, with or without a title", () => {
    expect(
      parseRelayPrefix('[Message from session "Plan v2" (p1)]\n\nStop'),
    ).toEqual({
      source: { kind: "session", sessionId: "p1", title: "Plan v2" },
      body: "Stop",
    });
    expect(parseRelayPrefix("[Message from session (p1)]\n\nStop")).toEqual({
      source: { kind: "session", sessionId: "p1" },
      body: "Stop",
    });
  });

  it("leaves other messages whole", () => {
    expect(parseRelayPrefix("[WIP] fix")).toEqual({ body: "[WIP] fix" });
  });

  it("quotes titles that would end the routing line early", () => {
    const line = `[Message from session "${relayTitle('Say "hi" [now]')}" (p1)]\n\nx`;
    expect(parseRelayPrefix(line).source?.title).toBe("Say hi now");
  });
});
