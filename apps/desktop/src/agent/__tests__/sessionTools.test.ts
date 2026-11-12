import { describe, expect, it, vi } from "vitest";
import type {
  ExtensionToolContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { PineApprovalMode } from "../../shared/agent";
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
  type PineSessionToolContext,
  type RenameCurrentSessionResult,
} from "../sessionTools";

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
  }
}

function setup(
  approvalMode: PineApprovalMode,
  decision: GateDecision = { kind: "allow" },
  parentSessionId?: string,
) {
  const requestHost = vi.fn(
    (request: AgentHostRequest): Promise<AgentHostResponse> => {
      if (request.kind !== "session") throw new Error("unexpected request");
      const { operation } = request;
      return Promise.resolve({ kind: "session", result: answer(operation) });
    },
  );
  const requestApproval = vi.fn().mockResolvedValue(decision);
  const renameCurrentSession = vi.fn(
    (title: string): RenameCurrentSessionResult =>
      title === "Locked"
        ? { renamed: false, reason: "user-title" }
        : { renamed: true, title },
  );
  const context: PineSessionToolContext = {
    requestHost,
    requestApproval,
    renameCurrentSession,
    getParentSessionId: () => parentSessionId,
    getApprovalMode: () => approvalMode,
    getLocale: () => "en-US",
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
    renameCurrentSession,
    requestHost,
    requestApproval,
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

  it("retitles this session and keeps a title the user chose", async () => {
    const { rename, renameCurrentSession } = setup("let-me-review");

    const renamed = await run(rename, { title: "Session folder tools" });
    const kept = await run(rename, { title: "Locked" });

    expect(renameCurrentSession).toHaveBeenCalledTimes(2);
    expect(text(renamed)).toBe('Title set to "Session folder tools".');
    expect(text(kept)).toContain("The user chose this session's title");
  });

  it("anchors retitling on a new task, not on follow-ups", () => {
    const { rename } = setup("auto-approve");

    const guidance = rename.promptGuidelines?.join("\n") ?? "";
    expect(guidance).toContain(
      "starts a new task or moves to a different area",
    );
    expect(guidance).toContain("Do not retitle for follow-ups");
    expect(guidance).toContain(
      "do not call ui_session_rename in the first turn",
    );
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

  it("says a message to a running session arrives at its next step", async () => {
    const { send } = setup("auto-approve");

    const result = await run(send, { sessionId: "s3", message: "Stop" });

    expect(text(result)).toContain("reads the message at its next step");
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
