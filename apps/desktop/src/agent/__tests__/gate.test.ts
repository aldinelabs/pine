import { describe, expect, it, vi } from "vitest";
import type { GateHost, JudgeRequest, JudgeRuling, ToolGate } from "../gate";
import { AutoReviewGate, normalizeCommand, UserApprovalGate } from "../gate";

interface HostMocks {
  emit: ReturnType<typeof vi.fn>;
  judge: ReturnType<typeof vi.fn>;
  recordApprovalDecision: ReturnType<typeof vi.fn>;
  requestUserApproval: ReturnType<typeof vi.fn>;
}

function createHost(
  judgeImpl: (
    request: JudgeRequest,
  ) => Promise<Omit<JudgeRuling, "toolCallId">> = () =>
    Promise.resolve({ verdict: "allow" }),
  requestApprovalImpl: GateHost["requestUserApproval"] = () =>
    Promise.resolve({ kind: "allow" }),
): { host: GateHost; mocks: HostMocks } {
  const emit = vi.fn();
  const judge = vi.fn(async (requests: JudgeRequest[]) =>
    Promise.all(
      requests.map(async (request) => ({
        toolCallId: request.toolCallId,
        ...(await judgeImpl(request)),
      })),
    ),
  );
  const requestUserApproval = vi.fn(requestApprovalImpl);
  const recordApprovalDecision = vi.fn();
  const host: GateHost = {
    sessionId: "session-1",
    emit,
    authorizationGrants: () => [],
    turnContext: () => ({
      recentUserStatements: [],
      recentEvents: [],
      grants: [],
    }),
    recordGrant: (grant) => ({
      ...grant,
      id: "grant-1",
      createdAt: "2026-09-11T00:00:00.000Z",
    }),
    recordApprovalDecision,
    judge,
    requestUserApproval,
  };
  return {
    host,
    mocks: { emit, judge, recordApprovalDecision, requestUserApproval },
  };
}

describe("UserApprovalGate", () => {
  it("lets read calls pass pre-execution review silently", async () => {
    const { host, mocks } = createHost();
    const gate = new UserApprovalGate(host);

    await expect(
      gate.reviewFileCall({
        toolCallId: "t0",
        toolName: "read",
        path: "/outside/notes.txt",
      }),
    ).resolves.toEqual({ kind: "allow" });
    expect(mocks.requestUserApproval).not.toHaveBeenCalled();
  });

  it("routes bash reviews to the user as pre-execution confirmations", async () => {
    const { host, mocks } = createHost(undefined, () =>
      Promise.resolve({ kind: "deny", reason: "no" }),
    );
    const gate = new UserApprovalGate(host);

    await expect(
      gate.reviewBashCommand({
        toolCallId: "t1",
        command: "npm test",
        signal: undefined,
      }),
    ).resolves.toEqual({ kind: "deny", reason: "no" });
    expect(mocks.requestUserApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: "pre-execution",
        toolCallId: "t1",
        toolName: "bash",
        subject: "npm test",
      }),
    );
    expect(mocks.recordApprovalDecision).not.toHaveBeenCalled();
  });

  it("maps denial reviews to their triggers and carries the evidence", async () => {
    const { host, mocks } = createHost();
    const gate = new UserApprovalGate(host);

    await gate.reviewDenial("sandbox", {
      toolCallId: "t2",
      toolName: "bash",
      subject: "npm install",
      evidence: "Operation not permitted",
      signal: undefined,
    });
    expect(mocks.requestUserApproval).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        trigger: "sandbox-denied",
        subject: "npm install",
        evidence: "Operation not permitted",
      }),
    );

    await gate.reviewDenial("authorize", {
      toolCallId: "t3",
      toolName: "write",
      subject: "/etc/hosts",
      evidence: "Path is outside the folders shared with Pine: /etc/hosts",
      signal: undefined,
    });
    expect(mocks.requestUserApproval).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        trigger: "authorize-denied",
        subject: "/etc/hosts",
      }),
    );
  });

  it("routes privileged calls to a distinct per-call user approval", async () => {
    const { host, mocks } = createHost();
    const gate = new UserApprovalGate(host);

    await gate.reviewPrivilegedCall({
      toolCallId: "privileged-1",
      toolName: "privileged_bash",
      subject: "open -a Finder",
      description: "Open Finder",
      evidence: "Native application control requires elevated execution.",
    });

    expect(mocks.requestUserApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: "privileged-execution",
        toolCallId: "privileged-1",
        toolName: "privileged_bash",
        subject: "open -a Finder",
      }),
    );
  });

  it("never remembers approved commands", () => {
    const { host } = createHost();
    const gate: ToolGate = new UserApprovalGate(host);
    expect(gate.isApprovedCommand("anything")).toBe(false);
  });
});

describe("AutoReviewGate", () => {
  it("allows ordinary commands without consulting the judge", async () => {
    const { host, mocks } = createHost();
    const gate = new AutoReviewGate(host);

    await expect(
      gate.reviewBashCommand({ toolCallId: "t1", command: "bun run test" }),
    ).resolves.toEqual({ kind: "allow" });
    expect(mocks.judge).not.toHaveBeenCalled();
  });

  it("escalates destructive-pattern matches to the judge", async () => {
    const { host, mocks } = createHost(() =>
      Promise.resolve({ verdict: "deny", reason: "untracked files" }),
    );
    const gate = new AutoReviewGate(host);

    await expect(
      gate.reviewBashCommand({
        toolCallId: "t1",
        command: "rm -rf node_modules",
      }),
    ).resolves.toEqual({ kind: "deny", reason: "untracked files" });
    expect(mocks.judge).toHaveBeenCalledWith([
      expect.objectContaining({
        toolCallId: "t1",
        trigger: "destructive-pattern",
        subject: "rm -rf node_modules",
        evidence: expect.stringContaining("recursive-force-delete"),
      }),
    ]);
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "approval-decided",
        verdict: "denied",
        decidedBy: "judge",
        reason: "untracked files",
      }),
    );
    expect(mocks.recordApprovalDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: expect.stringMatching(/^judge-/),
        toolCallId: "t1",
        verdict: "denied",
        decidedBy: "judge",
        reason: "untracked files",
      }),
    );
  });

  it("records session-scope approvals by exact command bytes", async () => {
    const { host, mocks } = createHost(() =>
      Promise.resolve({ verdict: "allow", scope: "session" }),
    );
    const gate = new AutoReviewGate(host);

    // Only escalated (destructive-pattern) commands reach the judge, so the
    // allowlist is exercised with a destructive command.
    await gate.reviewBashCommand({
      toolCallId: "t1",
      command: "rm    -rf   build",
    });
    expect(gate.isApprovedCommand("rm -rf build")).toBe(false);
    expect(gate.isApprovedCommand("rm    -rf   build")).toBe(true);

    mocks.judge.mockClear();
    await expect(
      gate.reviewBashCommand({
        toolCallId: "t2",
        command: "rm    -rf   build",
      }),
    ).resolves.toEqual({ kind: "allow" });
    expect(mocks.judge).not.toHaveBeenCalled();
  });

  it("reviews identical privileged calls every time without caching session scope", async () => {
    const { host, mocks } = createHost(() =>
      Promise.resolve({ verdict: "allow", scope: "session" }),
    );
    const gate = new AutoReviewGate(host);
    const review = {
      toolName: "privileged_bash",
      subject: "open -a Finder",
      description: "Open Finder",
      evidence: "Native application control requires elevated execution.",
    };

    await expect(
      gate.reviewPrivilegedCall({ toolCallId: "p1", ...review }),
    ).resolves.toEqual({ kind: "allow", scope: "once" });
    await expect(
      gate.reviewPrivilegedCall({ toolCallId: "p2", ...review }),
    ).resolves.toEqual({ kind: "allow", scope: "once" });

    expect(mocks.judge).toHaveBeenCalledTimes(2);
    expect(mocks.judge).toHaveBeenNthCalledWith(1, [
      expect.objectContaining({
        toolCallId: "p1",
        trigger: "privileged-execution",
        allowSessionScope: false,
      }),
    ]);
    expect(gate.isApprovedCommand("open -a Finder")).toBe(false);
  });

  it("batches parallel privileged calls into one judge request", async () => {
    const { host, mocks } = createHost((request) =>
      Promise.resolve(
        request.toolCallId === "p2"
          ? { verdict: "deny", reason: "unsafe target" }
          : { verdict: "allow", reason: "expected native operation" },
      ),
    );
    const gate = new AutoReviewGate(host);
    const review = {
      toolName: "privileged_bash",
      description: "Run a native operation",
      evidence: "Native permissions are required.",
    };

    const decisions = await Promise.all([
      gate.reviewPrivilegedCall({
        toolCallId: "p1",
        subject: "open -a Finder",
        ...review,
      }),
      gate.reviewPrivilegedCall({
        toolCallId: "p2",
        subject: "rm -rf ~/Documents",
        ...review,
      }),
      gate.reviewPrivilegedCall({
        toolCallId: "p3",
        subject: "osascript -e 'display dialog \"Done\"'",
        ...review,
      }),
    ]);

    expect(mocks.judge).toHaveBeenCalledTimes(1);
    expect(mocks.judge).toHaveBeenCalledWith([
      expect.objectContaining({ toolCallId: "p1" }),
      expect.objectContaining({ toolCallId: "p2" }),
      expect.objectContaining({ toolCallId: "p3" }),
    ]);
    expect(decisions).toEqual([
      { kind: "allow", scope: "once" },
      { kind: "deny", reason: "unsafe target" },
      { kind: "allow", scope: "once" },
    ]);
  });

  it("routes needs_user directly to the bound approval UI", async () => {
    const { host, mocks } = createHost(
      () =>
        Promise.resolve({
          verdict: "needs_user",
          reason: "Publishing needs explicit authorization.",
        }),
      () => Promise.resolve({ kind: "allow" }),
    );
    const gate = new AutoReviewGate(host);

    await expect(
      gate.reviewBashCommand({
        toolCallId: "publish-1",
        command: "bun publish",
        description: "Publish the package",
      }),
    ).resolves.toEqual({ kind: "allow" });
    expect(mocks.requestUserApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: "destructive-pattern",
        toolCallId: "publish-1",
        subject: "bun publish",
        description: "Publish the package",
        evidence: expect.stringContaining("explicit authorization"),
      }),
    );
    expect(mocks.requestUserApproval.mock.calls[0][0]).not.toHaveProperty(
      "autoApprovalFailure",
    );
    expect(mocks.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "approval-decided",
        decidedBy: "judge",
        verdict: "denied",
      }),
    );
  });

  it("asks the user when the judge errors", async () => {
    const { host, mocks } = createHost(undefined, () =>
      Promise.resolve({ kind: "allow" }),
    );
    mocks.judge.mockRejectedValue(new Error("provider down"));
    const gate = new AutoReviewGate(host);

    await expect(
      gate.reviewBashCommand({ toolCallId: "t1", command: "rm -rf build" }),
    ).resolves.toEqual({ kind: "allow" });
    expect(mocks.requestUserApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: "t1",
        evidence: expect.stringContaining("provider down"),
        autoApprovalFailure: {
          id: expect.any(String),
          message: "provider down",
        },
      }),
    );
    expect(mocks.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "approval-decided",
        verdict: "denied",
        decidedBy: "judge",
      }),
    );
  });

  it("asks the user after too many consecutive escalations", async () => {
    const { host, mocks } = createHost(() =>
      Promise.resolve({ verdict: "deny", reason: "denied" }),
    );
    const gate = new AutoReviewGate(host);
    const command = "rm -rf build";

    for (let index = 0; index < 5; index += 1) {
      await gate.reviewBashCommand({ toolCallId: `t${index}`, command });
    }
    expect(mocks.judge).toHaveBeenCalledTimes(5);

    const capped = await gate.reviewBashCommand({
      toolCallId: "t-final",
      command,
    });
    expect(capped).toEqual({ kind: "allow" });
    expect(mocks.judge).toHaveBeenCalledTimes(5);
    expect(mocks.requestUserApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: "t-final",
        evidence: expect.stringContaining("Too many escalations"),
      }),
    );
  });

  it("shares failure metadata across a failed review batch", async () => {
    const { host, mocks } = createHost();
    mocks.judge.mockRejectedValue(new Error("HTTP 429: quota exceeded"));
    const gate = new AutoReviewGate(host);

    const decisions = await Promise.all([
      gate.reviewPrivilegedCall({
        toolCallId: "p1",
        toolName: "bash",
        subject: "first command",
        evidence: "Native permissions required.",
      }),
      gate.reviewPrivilegedCall({
        toolCallId: "p2",
        toolName: "bash",
        subject: "second command",
        evidence: "Native permissions required.",
      }),
    ]);
    expect(decisions).toEqual([{ kind: "allow" }, { kind: "allow" }]);
    const failures = mocks.requestUserApproval.mock.calls.map(
      ([request]) => request.autoApprovalFailure,
    );
    expect(failures[0]).toEqual({
      id: expect.any(String),
      message: "HTTP 429: quota exceeded",
    });
    expect(failures[1]).toEqual(failures[0]);
  });

  it("marks an omitted ruling as a failed automatic review", async () => {
    const { host, mocks } = createHost();
    mocks.judge.mockResolvedValue([]);
    const gate = new AutoReviewGate(host);

    await expect(
      gate.reviewBashCommand({
        toolCallId: "missing",
        command: "rm -rf build",
      }),
    ).resolves.toEqual({ kind: "allow" });
    expect(mocks.requestUserApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        autoApprovalFailure: {
          id: expect.any(String),
          message: "The reviewer omitted this tool call from its rulings.",
        },
      }),
    );
  });

  it("resetTurn clears the escalation streak", async () => {
    const { host, mocks } = createHost(() =>
      Promise.resolve({ verdict: "deny", reason: "denied" }),
    );
    const gate = new AutoReviewGate(host);
    const command = "rm -rf build";

    for (let index = 0; index < 5; index += 1) {
      await gate.reviewBashCommand({ toolCallId: `t${index}`, command });
    }
    gate.resetTurn();

    await gate.reviewBashCommand({ toolCallId: "t-new", command });
    expect(mocks.judge).toHaveBeenCalledTimes(6);
  });

  it("keeps autonomous reviews in the agent loop when the judge requests a user", async () => {
    const { host, mocks } = createHost(() =>
      Promise.resolve({ verdict: "needs_user", reason: "Explain the target." }),
    );
    const gate = new AutoReviewGate(host, true);

    await expect(
      gate.reviewBashCommand({ toolCallId: "t1", command: "rm -rf build" }),
    ).resolves.toEqual({ kind: "deny", reason: "Explain the target." });
    expect(mocks.requestUserApproval).not.toHaveBeenCalled();
  });

  it("denies autonomous calls locally when the reviewer fails", async () => {
    const { host, mocks } = createHost();
    mocks.judge.mockRejectedValue(new Error("provider down"));
    const gate = new AutoReviewGate(host, true);

    await expect(
      gate.reviewBashCommand({ toolCallId: "t1", command: "rm -rf build" }),
    ).resolves.toEqual({
      kind: "deny",
      reason: "Auto-review unavailable: provider down",
    });
    expect(mocks.requestUserApproval).not.toHaveBeenCalled();
  });
});

describe("normalizeCommand", () => {
  it("preserves shell syntax and quoted data", () => {
    expect(normalizeCommand("  echo   'a  b'  ")).toBe("  echo   'a  b'  ");
  });
});
