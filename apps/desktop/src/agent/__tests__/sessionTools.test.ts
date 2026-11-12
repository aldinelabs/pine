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
  GateDecision,
} from "../protocol";
import {
  createSessionToolDefinitions,
  type PineSessionToolContext,
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

function setup(
  approvalMode: PineApprovalMode,
  decision: GateDecision = { kind: "allow" },
) {
  const requestHost = vi.fn(
    (request: AgentHostRequest): Promise<AgentHostResponse> => {
      if (request.kind !== "session") throw new Error("unexpected request");
      const { operation } = request;
      return Promise.resolve(
        operation.op === "search"
          ? { kind: "session", result: { op: "search", sessions: [session] } }
          : {
              kind: "session",
              result: {
                op: "start",
                sessionId: "new-session",
                projectId: session.projectId,
                projectName: "Pine",
                approvalMode: operation.approvalMode,
              },
            },
      );
    },
  );
  const requestApproval = vi.fn().mockResolvedValue(decision);
  const context: PineSessionToolContext = {
    requestHost,
    requestApproval,
    getApprovalMode: () => approvalMode,
    getLocale: () => "en-US",
  };
  const [search, start] = createSessionToolDefinitions(context);
  return { search, start, requestHost, requestApproval };
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
});
