import type { AttachedSession } from "../../shared/attachments";
import { describe, expect, it, vi } from "vitest";
import type {
  ExtensionToolContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  UI_SESSION_READ_TOOL_NAME,
  UI_SESSION_SEND_TOOL_NAME,
  type PineApprovalMode,
} from "../../shared/agent";
import type {
  AgentHostRequest,
  AgentHostResponse,
  AgentHostSession,
  AgentHostSessionTree,
  GateDecision,
  SessionHostOperation,
  SessionHostResult,
} from "../protocol";
import {
  createSessionToolDefinitions,
  resolveSessionModel,
  type PineSessionToolContext,
  type RenameCurrentSessionResult,
  type UsableModels,
} from "../sessionTools";

function usableModel(
  providerId: string,
  modelId: string,
  thinkingLevels: UsableModels["models"][number]["thinkingLevels"],
): UsableModels["models"][number] {
  return {
    providerId,
    providerName: providerId,
    modelId,
    name: `${modelId} name`,
    contextWindow: 200_000,
    maxTokens: 8_000,
    input: ["text"],
    reasoning: thinkingLevels.length > 1,
    thinkingLevels,
  };
}

const usable: UsableModels = {
  current: {
    providerId: "anthropic",
    modelId: "big",
    thinkingLevel: "high",
  },
  models: [
    usableModel("anthropic", "big", ["off", "low", "medium", "high"]),
    usableModel("anthropic", "small", ["off", "low", "medium"]),
    usableModel("openrouter", "shared", ["off"]),
    usableModel("other", "shared", ["off"]),
  ],
};

const session: AgentHostSession = {
  id: "5d1c7d0e-7a2b-4c43-9f1e-1b2a3c4d5e6f",
  projectId: "9ab0b15f-331f-4aa6-8056-cd2be3bf7414",
  projectName: "Pine",
  title: "Release notes",
  snippet: "draft the  changelog\nfor 1.4",
  createdAt: "2026-11-01T08:00:00.000Z",
  updatedAt: "2026-11-02T08:00:00.000Z",
  messageCount: 12,
  current: true,
};

const tree: AgentHostSessionTree = {
  projectId: session.projectId,
  projectName: "Pine",
  revision: "r1",
  folders: [
    {
      id: "f1",
      name: "Release",
      sessions: [{ id: session.id, title: "Release notes", current: true }],
    },
  ],
  unfiled: [{ id: "s2", updatedAt: "2026-11-03T08:00:00.000Z" }],
  moreUnfiled: 4,
};

function answer(operation: SessionHostOperation): SessionHostResult {
  switch (operation.op) {
    case "search":
      return { op: "search", sessions: [session] };
    case "start":
      return {
        op: "start",
        sessionId: "new-session",
        projectId: session.projectId,
        projectName: "Pine",
        approvalMode: operation.approvalMode,
      };
    case "tree":
      return { op: "tree", tree };
    case "organize":
      return { op: "organize", tree, createdFolderIds: ["f2"] };
    case "describe":
      return {
        op: "describe",
        session: { ...session, id: "s2", current: undefined },
        subSessionCount: 2,
        state: "running",
      };
    case "delete":
      return { op: "delete", deleted: true };
    case "relatives":
      return {
        op: "relatives",
        parent: { id: "p", title: "Plan", state: "running" },
        children: [],
        siblings: [{ id: "s3", state: "awaiting-approval" }],
      };
    case "read":
      return {
        op: "read",
        sessionId: operation.sessionId,
        title: "Plan",
        messages: [
          { role: "user", createdAt: "t1", text: "Go" },
          { role: "assistant", createdAt: "t2", text: "Done [tool bash]" },
        ],
        olderCursor: "c1",
      };
    case "send":
      return { op: "send", delivered: "steer" };
    case "stop":
      return { op: "stop", stopped: true };
  }
}

function setup(
  approvalMode: PineApprovalMode,
  decision: GateDecision = { kind: "allow" },
  parentSessionId?: string,
  attachedSessions: AttachedSession[] = [],
  override: (
    operation: SessionHostOperation,
  ) => SessionHostResult | undefined = () => undefined,
) {
  const requestHost = vi.fn(
    (request: AgentHostRequest): Promise<AgentHostResponse> => {
      if (request.kind !== "session") throw new Error("unexpected request");
      const { operation } = request;
      return Promise.resolve({
        kind: "session",
        result: override(operation) ?? answer(operation),
      });
    },
  );
  const requestApproval = vi.fn().mockResolvedValue(decision);
  const reviewOutOfScope = vi.fn().mockResolvedValue(decision);
  const renameCurrentSession = vi.fn(
    (title: string): RenameCurrentSessionResult =>
      title === "Locked"
        ? { renamed: false, reason: "declined" }
        : title === "Proposed"
          ? { renamed: false, reason: "suggested", title }
          : { renamed: true, title },
  );
  const context: PineSessionToolContext = {
    requestHost,
    requestApproval,
    reviewOutOfScope,
    renameCurrentSession,
    getParentSessionId: () => parentSessionId,
    attachedSessions: () => attachedSessions,
    getApprovalMode: () => approvalMode,
    getLocale: () => "en-US",
    usableModels: () => Promise.resolve(usable),
  };
  const [
    search,
    start,
    treeTool,
    organize,
    rename,
    remove,
    relatives,
    read,
    send,
    stop,
  ] = createSessionToolDefinitions(context);
  return {
    search,
    start,
    treeTool,
    organize,
    rename,
    remove,
    relatives,
    read,
    send,
    stop,
    renameCurrentSession,
    requestHost,
    requestApproval,
    reviewOutOfScope,
  };
}

function run(tool: ToolDefinition, params: unknown) {
  return tool.execute(
    "call-1",
    params,
    undefined,
    undefined,
    {} as ExtensionToolContext,
  );
}

function text(result: Awaited<ReturnType<typeof run>>): string {
  return (result.content[0] as { text: string }).text;
}

describe("session tools", () => {
  it("lists recent sessions for a bare wildcard", async () => {
    const { search, requestHost } = setup("auto-approve");

    const result = await run(search, { query: " ** " });

    expect(requestHost).toHaveBeenCalledWith({
      kind: "session",
      operation: { op: "search", query: "", limit: 20 },
    });
    expect(text(result)).toContain(
      "Release notes (id: 5d1c7d0e-7a2b-4c43-9f1e-1b2a3c4d5e6f; project: Pine",
    );
    expect(text(result)).toContain("current session");
    expect(text(result)).toContain("\n  draft the changelog for 1.4");
  });

  it("caps the search limit and scopes it to a project", async () => {
    const { search, requestHost } = setup("auto-approve");

    await run(search, { query: "changelog", projectId: " p1 ", limit: 500 });

    expect(requestHost).toHaveBeenCalledWith({
      kind: "session",
      operation: {
        op: "search",
        query: "changelog",
        projectId: "p1",
        limit: 50,
      },
    });
  });

  it("tells the model in its description when sub-sessions pay off", () => {
    // Pine's own system prompt leaves out pi's prompt guidelines.
    const { description, promptGuidelines } = setup("YOLO").start;
    expect(promptGuidelines).toBeUndefined();
    expect(description).toContain("Start them all in the same step");
    expect(description).toContain("Do the work directly here instead");
    expect(description).toContain(UI_SESSION_READ_TOOL_NAME);
    expect(description).toContain(UI_SESSION_SEND_TOOL_NAME);
    expect(description).toContain(
      "Leave model and thinkingLevel out unless the user explicitly asks",
    );
  });

  it("invites background research and asks the model to keep working and verify", () => {
    const { description } = setup("YOLO").start;
    expect(description).toContain("Use it on your own judgment");
    expect(description).toContain(
      "Background research on a substantial task, when web_search is available",
    );
    expect(description).toContain("Keep the count small");
    expect(description).toContain("Keep working here on what is left");
    expect(description).toContain(
      "Check what a sub-session reports against the files or sources",
    );
  });

  it("starts a session in the caller's mode without asking outside Let Me Review", async () => {
    const { start, requestHost, requestApproval } = setup("YOLO");

    const result = await run(start, { message: "  Fix the build  " });

    expect(requestApproval).not.toHaveBeenCalled();
    expect(requestHost).toHaveBeenCalledWith({
      kind: "session",
      operation: {
        op: "start",
        relation: "child",
        message: "Fix the build",
        approvalMode: "YOLO",
        locale: "en-US",
      },
    });
    expect(result.details).toMatchObject({
      started: true,
      sessionId: "new-session",
    });
  });

  it("refuses a less supervised mode than the caller's", async () => {
    const { start, requestHost } = setup("auto-approve");

    await expect(
      run(start, { message: "Go", approvalMode: "YOLO" }),
    ).rejects.toThrow("cannot use YOLO");
    expect(requestHost).not.toHaveBeenCalled();
  });

  it("allows a more supervised mode", async () => {
    const { start, requestHost } = setup("autonomous");

    await run(start, { message: "Go", approvalMode: "let-me-review" });

    expect(requestHost).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({ approvalMode: "let-me-review" }),
      }),
    );
  });

  it("asks the user in Let Me Review and starts nothing when denied", async () => {
    const { start, requestHost, requestApproval } = setup("let-me-review", {
      kind: "deny",
      reason: "Not now.",
    });

    const result = await run(start, { message: "Write the report" });

    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "ui_session_new",
        evidence: "Write the report",
      }),
    );
    expect(requestHost).not.toHaveBeenCalled();
    expect(result.details).toEqual({ started: false });
    expect(text(result)).toContain("Not now.");
  });

  it("starts a session on a chosen model and says which", async () => {
    const { start, requestHost } = setup("auto-approve");

    const result = await run(start, {
      message: "List the TODOs",
      model: "anthropic/small",
      thinkingLevel: "low",
    });

    expect(requestHost).toHaveBeenCalledWith({
      kind: "session",
      operation: expect.objectContaining({
        op: "start",
        model: {
          providerId: "anthropic",
          modelId: "small",
          thinkingLevel: "low",
        },
      }),
    });
    expect(text(result)).toContain("on anthropic/small with thinking low");
    expect(result.details).toMatchObject({
      model: { modelId: "small", name: "small name", thinkingLevel: "low" },
    });
  });

  it("leaves the model alone when none is asked for", async () => {
    const { start, requestHost } = setup("auto-approve");

    await run(start, { message: "Go" });

    const operation = (
      requestHost.mock.calls[0]?.[0] as { operation: SessionHostOperation }
    ).operation;
    expect(operation).not.toHaveProperty("model");
  });

  it("names the choices instead of starting on an unknown model", async () => {
    const { start, requestHost } = setup("auto-approve");

    await expect(run(start, { message: "Go", model: "gpt-9" })).rejects.toThrow(
      'Model "gpt-9" is not one the user can use. Use providerId/modelId from ui_list_models: anthropic/big, anthropic/small, openrouter/shared, other/shared.',
    );
    expect(requestHost).not.toHaveBeenCalled();
  });

  it("asks for the reviewer to see the model in Let Me Review", async () => {
    const { start, requestApproval } = setup("let-me-review", {
      kind: "deny",
    });

    await run(start, { message: "Go", model: "small" });

    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining("on small name (thinking medium)"),
      }),
    );
  });

  it("shows folders, their sessions and what is outside them", async () => {
    const { treeTool, requestHost } = setup("auto-approve");

    const result = await run(treeTool, {});

    expect(requestHost).toHaveBeenCalledWith({
      kind: "session",
      operation: { op: "tree", limit: 20 },
    });
    expect(text(result)).toBe(
      [
        `Project Pine (id: ${session.projectId}; revision: r1)`,
        'Folder "Release" (id: f1)',
        `  - Release notes (id: ${session.id}; current session)`,
        "Not in a folder:",
        "  - (untitled) (id: s2; updated 2026-11-03T08:00:00.000Z)",
        "  …and 4 older; raise limit to see them.",
      ].join("\n"),
    );
  });

  it("maps organize edits and refers to new folders", async () => {
    const { organize, requestHost, requestApproval } = setup("autonomous");

    const result = await run(organize, {
      projectId: "p1",
      revision: "r1",
      operations: [
        { op: "create_folder", name: " Drafts " },
        { op: "move", sessionId: "s2", folderId: "new:1" },
        { op: "move", sessionId: "s3" },
        { op: "rename_session", sessionId: "s2", name: "Plan" },
      ],
    });

    expect(requestApproval).not.toHaveBeenCalled();
    expect(requestHost).toHaveBeenCalledWith({
      kind: "session",
      operation: {
        op: "organize",
        projectId: "p1",
        revision: "r1",
        operations: [
          { op: "create-folder", name: "Drafts" },
          { op: "move", sessionId: "s2", folderId: "new:1" },
          { op: "move", sessionId: "s3", folderId: null },
          { op: "rename-session", sessionId: "s2", name: "Plan" },
        ],
      },
    });
    expect(text(result)).toContain("New folder ids: f2.");
  });

  it("rejects an edit missing what it needs", async () => {
    const { organize, requestHost } = setup("auto-approve");

    await expect(
      run(organize, {
        projectId: "p1",
        revision: "r1",
        operations: [{ op: "rename_folder", folderId: "f1" }],
      }),
    ).rejects.toThrow("Operation 1 (rename_folder) needs name.");
    expect(requestHost).not.toHaveBeenCalled();
  });

  it("asks before deleting a session even in YOLO", async () => {
    const { remove, requestHost, requestApproval } = setup("YOLO", {
      kind: "deny",
    });

    const result = await run(remove, { projectId: "p1", sessionId: "s2" });

    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "ui_session_delete",
        subject: "Delete session “Release notes” permanently",
      }),
    );
    expect(requestHost).toHaveBeenCalledTimes(1);
    expect(result.details).toEqual({ done: false });
  });

  it("retitles this session and asks before replacing a title the user chose", async () => {
    const { rename, renameCurrentSession } = setup("let-me-review");

    const renamed = await run(rename, { title: "Session folder tools" });
    const suggested = await run(rename, { title: "Proposed" });
    const kept = await run(rename, { title: "Locked" });

    expect(renameCurrentSession).toHaveBeenCalledTimes(3);
    expect(text(renamed)).toBe('Title set to "Session folder tools".');
    expect(text(suggested)).toContain('whether to use "Proposed"');
    expect(text(kept)).toContain("no title suggestions");
  });

  it("starts a sibling from a sub-session and refuses a nested child", async () => {
    const { start, requestHost } = setup("auto-approve", undefined, "parent");

    await run(start, { message: "Check the docs" });
    expect(requestHost).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({ relation: "sibling" }),
      }),
    );
    await expect(
      run(start, { message: "Go deeper", relation: "child" }),
    ).rejects.toThrow("sub-sessions go one level deep");
  });

  it("lists relatives with what each is doing", async () => {
    const { relatives } = setup("auto-approve");

    const result = await run(relatives, {});

    expect(text(result)).toBe(
      [
        "- parent: Plan (id: p; running)",
        "- sibling: (untitled) (id: s3; awaiting-approval)",
      ].join("\n"),
    );
  });

  it("reads a relative's messages with a cursor for older ones", async () => {
    const { read, requestHost } = setup("auto-approve");

    const result = await run(read, { sessionId: " p ", limit: 99 });

    expect(requestHost).toHaveBeenCalledWith({
      kind: "session",
      operation: { op: "read", sessionId: "p", limit: 50 },
    });
    expect(text(result)).toContain("[assistant · t2]\nDone [tool bash]");
    expect(text(result)).toContain('read again with before "c1"');
  });

  it("reviews reading a session outside the relatives once, then pages freely", async () => {
    const { read, requestHost, reviewOutOfScope } = setup("auto-approve");

    await expect(run(read, { sessionId: "s2" })).rejects.toThrow(
      /Pass its projectId/,
    );
    await run(read, { sessionId: "s2", projectId: "p1" });
    expect(reviewOutOfScope).toHaveBeenCalledTimes(1);
    expect(reviewOutOfScope.mock.calls[0][0]).toMatchObject({
      toolName: "ui_session_read",
      subject: "Read session “Release notes” in Pine",
    });
    expect(requestHost).toHaveBeenLastCalledWith({
      kind: "session",
      operation: { op: "read", sessionId: "s2", projectId: "p1", limit: 10 },
    });
    await run(read, { sessionId: "s2", projectId: "p1", before: "c1" });
    expect(reviewOutOfScope).toHaveBeenCalledTimes(1);
  });

  it("reads a session the user attached without review", async () => {
    const { read, requestHost, reviewOutOfScope } = setup(
      "auto-approve",
      { kind: "deny" },
      undefined,
      [{ projectId: "p1", sessionId: "s2", projectName: "Pine" }],
    );

    // The attachment supplies the project when the model leaves it out.
    const result = await run(read, { sessionId: "s2" });
    expect(text(result)).toContain("[user · t1]\nGo");
    expect(reviewOutOfScope).not.toHaveBeenCalled();
    expect(requestHost).toHaveBeenLastCalledWith({
      kind: "session",
      operation: { op: "read", sessionId: "s2", projectId: "p1", limit: 10 },
    });

    // The same id in another project is not the attached session.
    const other = await run(read, { sessionId: "s2", projectId: "p9" });
    expect(reviewOutOfScope).toHaveBeenCalledTimes(1);
    expect(text(other)).toContain("was not approved");
  });

  it("does not read a session outside the relatives when the review denies it", async () => {
    const { read, requestHost } = setup("auto-approve", {
      kind: "deny",
      reason: "Not needed.",
    });

    const result = await run(read, { sessionId: "s2", projectId: "p1" });

    expect(text(result)).toBe(
      "Reading that session was not approved. Not needed.",
    );
    expect(
      requestHost.mock.calls.some(
        ([request]) =>
          request.kind === "session" && request.operation.op === "read",
      ),
    ).toBe(false);
  });

  it("says a message to a running session arrives at its next step", async () => {
    const { send } = setup("auto-approve");

    const result = await run(send, { sessionId: "s3", message: "Stop" });

    expect(text(result)).toContain("reads the message at its next step");
  });

  it("reviews every message to a session outside the relatives", async () => {
    const { send, requestHost, reviewOutOfScope } = setup("auto-approve");

    await expect(run(send, { sessionId: "s2", message: "Go" })).rejects.toThrow(
      /Pass its projectId/,
    );
    await run(send, { sessionId: "s2", projectId: "p1", message: "Go" });
    await run(send, { sessionId: "s2", projectId: "p1", message: "Again" });

    expect(reviewOutOfScope).toHaveBeenCalledTimes(2);
    expect(reviewOutOfScope.mock.calls[0][0]).toMatchObject({
      toolName: "ui_session_send",
      subject: "Message session “Release notes” in Pine",
      evidence: expect.stringContaining("Message: Go"),
    });
    expect(requestHost).toHaveBeenLastCalledWith({
      kind: "session",
      operation: {
        op: "send",
        sessionId: "s2",
        projectId: "p1",
        message: "Again",
        locale: "en-US",
      },
    });
  });

  it("does not message a session outside the relatives when the review denies it", async () => {
    const { send, requestHost } = setup("auto-approve", {
      kind: "deny",
      reason: "Ask first.",
    });

    const result = await run(send, {
      sessionId: "s2",
      projectId: "p1",
      message: "Go",
    });

    expect(text(result)).toBe(
      "Messaging that session was not approved. Ask first.",
    );
    expect(
      requestHost.mock.calls.some(
        ([request]) =>
          request.kind === "session" && request.operation.op === "send",
      ),
    ).toBe(false);
  });

  it("names the sub-sessions a deletion takes with it", async () => {
    const { remove, requestApproval } = setup("auto-approve", { kind: "deny" });

    await run(remove, { projectId: "p1", sessionId: "s2" });

    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: expect.stringContaining(
          "Its 2 sub-sessions are deleted too.",
        ),
      }),
    );
  });
});

describe("ui_session_stop", () => {
  const withChild =
    (state: "running" | "idle" | "awaiting-approval") =>
    (operation: SessionHostOperation): SessionHostResult | undefined =>
      operation.op === "relatives"
        ? {
            op: "relatives",
            children: [{ id: "c1", title: "Docs pass", state }],
            siblings: [],
          }
        : undefined;
  const stopCalls = (requestHost: ReturnType<typeof setup>["requestHost"]) =>
    requestHost.mock.calls
      .map(([request]) => request)
      .filter(
        (request) =>
          request.kind === "session" && request.operation.op === "stop",
      );

  it("stops its own sub-session without review, even in Let Me Review", async () => {
    const { stop, requestHost, reviewOutOfScope, requestApproval } = setup(
      "let-me-review",
      { kind: "deny" },
      undefined,
      [],
      withChild("awaiting-approval"),
    );

    const result = await run(stop, { sessionId: " c1 " });

    expect(reviewOutOfScope).not.toHaveBeenCalled();
    expect(requestApproval).not.toHaveBeenCalled();
    expect(stopCalls(requestHost)).toEqual([
      { kind: "session", operation: { op: "stop", sessionId: "c1" } },
    ]);
    expect(text(result)).toBe(
      "Stopped the current turn of session Docs pass. It stays in the sidebar; use ui_session_send to give it more work.",
    );
    expect(result.details).toEqual({
      sessionId: "c1",
      title: "Docs pass",
      stopped: true,
    });
  });

  it("does nothing for an idle sub-session and says so", async () => {
    const { stop, requestHost } = setup(
      "auto-approve",
      undefined,
      undefined,
      [],
      withChild("idle"),
    );

    const result = await run(stop, { sessionId: "c1" });

    expect(stopCalls(requestHost)).toEqual([]);
    expect(text(result)).toBe(
      "Session Docs pass has no turn running; there was nothing to stop.",
    );
    expect(result.details).toMatchObject({ stopped: false, idle: true });
  });

  it("reviews stopping a sibling", async () => {
    const { stop, requestHost, reviewOutOfScope } = setup("auto-approve");

    await run(stop, { sessionId: "s3" });

    expect(reviewOutOfScope).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "ui_session_stop",
        subject: "Stop session “Untitled”",
        description: "Stop another session's current turn",
        evidence: expect.stringContaining("waiting for an approval"),
      }),
    );
    expect(stopCalls(requestHost)).toEqual([
      { kind: "session", operation: { op: "stop", sessionId: "s3" } },
    ]);
  });

  it("reviews any other session and stops nothing when denied", async () => {
    const { stop, requestHost, reviewOutOfScope } = setup("auto-approve", {
      kind: "deny",
      reason: "Leave it.",
    });

    const result = await run(stop, { sessionId: "s2", projectId: "p1" });

    expect(reviewOutOfScope).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Stop session “Release notes” in Pine",
        evidence: expect.stringContaining(
          "not this session's parent, sub-session or sibling",
        ),
      }),
    );
    expect(stopCalls(requestHost)).toEqual([]);
    expect(text(result)).toBe(
      "Stopping that session was not approved. Leave it.",
    );
    expect(result.details).toMatchObject({ stopped: false, declined: true });
  });

  it("stops another session in its project once approved", async () => {
    const { stop, requestHost } = setup("auto-approve");

    await run(stop, { sessionId: "s2", projectId: " p1 " });

    expect(stopCalls(requestHost)).toEqual([
      {
        kind: "session",
        operation: { op: "stop", sessionId: "s2", projectId: "p1" },
      },
    ]);
  });

  it("skips the review for another session that is idle", async () => {
    const { stop, reviewOutOfScope } = setup(
      "let-me-review",
      undefined,
      undefined,
      [],
      (operation) =>
        operation.op === "describe"
          ? {
              op: "describe",
              session: { ...session, id: "s2", current: undefined },
              subSessionCount: 0,
              state: "idle",
            }
          : undefined,
    );

    const result = await run(stop, { sessionId: "s2", projectId: "p1" });

    expect(reviewOutOfScope).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({ idle: true });
  });

  it("refuses to stop the calling session", async () => {
    const { stop, requestHost, reviewOutOfScope } = setup(
      "YOLO",
      undefined,
      undefined,
      [],
      (operation) =>
        operation.op === "describe"
          ? {
              op: "describe",
              session,
              subSessionCount: 0,
              state: "running",
            }
          : undefined,
    );

    await expect(
      run(stop, { sessionId: session.id, projectId: session.projectId }),
    ).rejects.toThrow("A session cannot stop itself.");
    expect(reviewOutOfScope).not.toHaveBeenCalled();
    expect(stopCalls(requestHost)).toEqual([]);
  });

  it("needs a project for a session outside the relatives", async () => {
    const { stop } = setup("auto-approve");

    await expect(run(stop, { sessionId: "s9" })).rejects.toThrow(
      "Pass its projectId from ui_session_search to stop it.",
    );
  });

  it("reports a turn that ended before the stop arrived", async () => {
    const { stop } = setup(
      "auto-approve",
      undefined,
      undefined,
      [],
      (operation) =>
        operation.op === "stop"
          ? { op: "stop", stopped: false }
          : withChild("running")(operation),
    );

    const result = await run(stop, { sessionId: "c1" });

    expect(text(result)).toContain("there was nothing to stop");
  });
});

describe("resolveSessionModel", () => {
  it("is undefined when neither a model nor a level is given", () => {
    expect(resolveSessionModel(usable, " ", undefined)).toBeUndefined();
  });

  it("accepts a bare model id offered by one provider", () => {
    expect(resolveSessionModel(usable, "small", undefined)).toEqual({
      providerId: "anthropic",
      modelId: "small",
      // This session thinks high; small tops out at medium.
      thinkingLevel: "medium",
      name: "small name",
    });
  });

  it("asks which provider when a bare id is ambiguous", () => {
    expect(() => resolveSessionModel(usable, "shared", undefined)).toThrow(
      'Model "shared" is offered by more than one provider. Use one of: openrouter/shared, other/shared.',
    );
    expect(
      resolveSessionModel(usable, "other/shared", undefined),
    ).toMatchObject({ providerId: "other", thinkingLevel: "off" });
  });

  it("refuses a thinking level the model lacks and lists its levels", () => {
    expect(() => resolveSessionModel(usable, "anthropic/small", "max")).toThrow(
      "anthropic/small does not support thinking level max. It supports: off, low, medium.",
    );
  });

  it("changes only the level on this session's model", () => {
    expect(resolveSessionModel(usable, undefined, "low")).toEqual({
      providerId: "anthropic",
      modelId: "big",
      thinkingLevel: "low",
      name: "big name",
    });
  });

  it("says so when the user has no usable model", () => {
    expect(() =>
      resolveSessionModel({ models: [] }, "anthropic/big", undefined),
    ).toThrow("(none; the user has no provider set up)");
  });
});
