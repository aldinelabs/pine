import { describe, expect, it, vi } from "vitest";
import type { McpToolApprovalRequest } from "pi-mcp-adapter";
import { AutoReviewGate } from "../gate";
import type { GateHost, JudgeRequest, JudgeRuling } from "../gate";
import { McpScriptApprovalCache, mcpShapeKey } from "../mcp-approval";

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
  it("reviews a 20-iteration script loop once instead of 20 times", async () => {
    const { gate, judge } = setup();
    const cache = new McpScriptApprovalCache();
    const decisions: string[] = [];
    for (let id = 0; id < 20; id += 1) {
      decisions.push(await cache.decide(request({ id, tag: `n${id}` }), gate));
    }
    expect(decisions.every((d) => d === "allow_once")).toBe(true);
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it("without the cache every call reaches the judge (baseline)", async () => {
    const { gate, judge } = setup();
    for (let id = 0; id < 3; id += 1) {
      await gate.reviewPrivilegedCall({
        toolCallId: `b${id}`,
        toolName: "notes_get_note",
        subject: `notes.get_note {"id":${id}}`,
        evidence: "",
      });
    }
    expect(judge).toHaveBeenCalledTimes(3);
  });

  it("re-reviews a different tool or a different argument shape", async () => {
    const { gate, judge } = setup();
    const cache = new McpScriptApprovalCache();
    await cache.decide(request({ id: 1 }), gate);
    await cache.decide(request({ id: 2 }), gate);
    await cache.decide(request({ id: 3, force: true }), gate);
    await cache.decide(request({ id: "3" }), gate);
    await cache.decide(
      request({ id: 1 }, { originalToolName: "delete_note" }),
      gate,
    );
    expect(judge).toHaveBeenCalledTimes(4);
  });

  it("never reuses an allow for direct (non-script) calls", async () => {
    const { gate, judge } = setup();
    const cache = new McpScriptApprovalCache();
    await cache.decide(request({ id: 1 }), gate);
    await cache.decide(request({ id: 2 }, { origin: "proxy" }), gate);
    await cache.decide(request({ id: 3 }, { origin: "proxy" }), gate);
    expect(judge).toHaveBeenCalledTimes(3);
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
    await cache.decide(request({ id: 2 }), gate);
    expect(judge).toHaveBeenCalledTimes(2);
  });
});

describe("mcpShapeKey", () => {
  it("ignores values and key order but not keys or types", () => {
    const a = mcpShapeKey(request({ a: 1, b: ["x"] }));
    expect(mcpShapeKey(request({ b: ["y", "z"], a: 9 }))).toBe(a);
    expect(mcpShapeKey(request({ a: 1 }))).not.toBe(a);
    expect(mcpShapeKey(request({ a: "1", b: ["x"] }))).not.toBe(a);
  });
});
