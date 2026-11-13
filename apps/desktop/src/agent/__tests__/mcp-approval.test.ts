import { describe, expect, it, vi } from "vitest";
import type { McpToolApprovalRequest } from "pi-mcp-adapter";
import { AutoReviewGate } from "../gate";
import type { GateHost, JudgeRequest, JudgeRuling, ToolGate } from "../gate";
import { McpScriptApprovalCache, mcpCallKey } from "../mcp-approval";

let counter = 0;
function request(
  args: Record<string, unknown>,
  overrides: Partial<McpToolApprovalRequest> = {},
): McpToolApprovalRequest {
  return {
    requestId: `req-${++counter}`,
    serverName: "notes",
    originalToolName: "get_note",
    prefixedToolName: "notes_get_note",
    args,
    origin: "script",
    claim: () => true,
    ...overrides,
  };
}

function setup(verdict: JudgeRuling["verdict"] = "allow") {
  const judge = vi.fn((requests: JudgeRequest[]) =>
    Promise.resolve(
      requests.map((r) => ({ toolCallId: r.toolCallId, verdict })),
    ),
  );
  const host: GateHost = {
    sessionId: "s",
    emit: vi.fn(),
    authorizationGrants: () => [],
    turnContext: () => ({
      recentUserStatements: [],
      recentEvents: [],
      grants: [],
    }),
    recordGrant: (grant) => ({ ...grant, id: "g", createdAt: "" }),
    recordApprovalDecision: vi.fn(),
    judge,
    requestUserApproval: vi.fn(() =>
      Promise.resolve({ kind: "deny" as const }),
    ),
  };
  return { gate: new AutoReviewGate(host, true), judge };
}

describe("McpScriptApprovalCache", () => {
  it("reviews each loop iteration whose arguments differ", async () => {
    const { gate, judge } = setup();
    const cache = new McpScriptApprovalCache();
    for (let id = 0; id < 5; id += 1)
      expect(await cache.decide(request({ id }), gate)).toBe("allow_once");
    expect(judge).toHaveBeenCalledTimes(5);
  });

  it("reuses an allow for exactly the same call", async () => {
    const { gate, judge } = setup();
    const cache = new McpScriptApprovalCache();
    for (let round = 0; round < 5; round += 1)
      expect(await cache.decide(request({ id: 1, tags: ["a"] }), gate)).toBe(
        "allow_once",
      );
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it("sends calls a script starts together as one review", async () => {
    const { gate, judge } = setup();
    const cache = new McpScriptApprovalCache();
    const decisions = await Promise.all(
      [1, 2, 3].map((id) => cache.decide(request({ id }), gate)),
    );
    expect(decisions).toEqual(["allow_once", "allow_once", "allow_once"]);
    expect(judge).toHaveBeenCalledTimes(1);
    expect(judge.mock.calls[0]?.[0]).toHaveLength(3);
  });

  it("re-reviews a different tool or any different argument", async () => {
    const { gate, judge } = setup();
    const cache = new McpScriptApprovalCache();
    await cache.decide(request({ id: 1 }), gate);
    await cache.decide(request({ id: 1, force: true }), gate);
    await cache.decide(request({ id: "1" }), gate);
    await cache.decide(
      request({ id: 1 }, { originalToolName: "delete_note" }),
      gate,
    );
    expect(judge).toHaveBeenCalledTimes(4);
  });

  it("never reuses an allow for direct (non-script) calls", async () => {
    const { gate, judge } = setup();
    const cache = new McpScriptApprovalCache();
    await cache.decide(request({ id: 1 }, { origin: "proxy" }), gate);
    await cache.decide(request({ id: 1 }, { origin: "proxy" }), gate);
    expect(judge).toHaveBeenCalledTimes(2);
  });

  it("keeps denials per call and does not cache them", async () => {
    const { gate, judge } = setup("deny");
    const cache = new McpScriptApprovalCache();
    expect(await cache.decide(request({ id: 1 }), gate)).toBe("deny");
    expect(await cache.decide(request({ id: 2 }), gate)).toBe("deny");
    expect(judge).toHaveBeenCalledTimes(2);
  });

  it("clear() forces a fresh review on the next turn", async () => {
    const { gate, judge } = setup();
    const cache = new McpScriptApprovalCache();
    await cache.decide(request({ id: 1 }), gate);
    cache.clear();
    await cache.decide(request({ id: 1 }), gate);
    expect(judge).toHaveBeenCalledTimes(2);
  });
});

describe("McpScriptApprovalCache with a person approving", () => {
  it("asks again for every call, since a person approves one call", async () => {
    const reviewPrivilegedCall = vi.fn(() =>
      Promise.resolve({ kind: "allow" as const }),
    );
    const gate = { reviewPrivilegedCall } as unknown as ToolGate;
    const cache = new McpScriptApprovalCache();
    await cache.decide(request({ id: 1 }), gate);
    await cache.decide(request({ id: 1 }), gate);
    expect(reviewPrivilegedCall).toHaveBeenCalledTimes(2);
  });
});

describe("mcpCallKey", () => {
  it("ignores key order but not any value", () => {
    const a = mcpCallKey(request({ a: 1, b: { x: 1, y: 2 } }));
    expect(mcpCallKey(request({ b: { y: 2, x: 1 }, a: 1 }))).toBe(a);
    expect(mcpCallKey(request({ a: 2, b: { x: 1, y: 2 } }))).not.toBe(a);
    expect(mcpCallKey(request({ a: "1", b: { x: 1, y: 2 } }))).not.toBe(a);
  });
});
