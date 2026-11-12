import { describe, expect, it, vi } from "vitest";
import type {
  ExtensionToolContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentHostRequest,
  AgentHostResponse,
  GateDecision,
  ProjectHostOperation,
  ProjectHostResult,
} from "../protocol";
import { createProjectToolDefinitions } from "../projectTools";

const projects = [
  {
    id: "p-current",
    name: "Pine",
    current: true,
    defaultFolderPath: "/code/pine",
    folders: [
      { access: "read-write" as const, name: "pine", path: "/code/pine" },
    ],
  },
  {
    id: "p-other",
    name: "Notes",
    defaultFolderPath: "/notes",
    folders: [{ access: "read-write" as const, name: "notes", path: "/notes" }],
  },
];

function answer(operation: ProjectHostOperation): ProjectHostResult {
  switch (operation.op) {
    case "create":
      return { op: "create", projectId: "p-new", projectName: operation.name };
    case "update":
      return {
        op: "update",
        projectId: operation.projectId,
        projectName: operation.name ?? "Pine",
        applied: operation.projectId === "p-current" ? "after-reply" : "now",
      };
    case "delete":
      return { op: "delete", projectName: "Notes" };
  }
}

function setup(decision: GateDecision = { kind: "allow" }) {
  const requestHost = vi.fn(
    (request: AgentHostRequest): Promise<AgentHostResponse> => {
      if (request.kind === "list-projects")
        return Promise.resolve({ kind: "list-projects", projects });
      if (request.kind !== "project") throw new Error("unexpected request");
      return Promise.resolve({
        kind: "project",
        result: answer(request.operation),
      });
    },
  );
  const requestApproval = vi.fn().mockResolvedValue(decision);
  const [create, update, remove] = createProjectToolDefinitions({
    requestHost,
    requestApproval,
  });
  return { create, update, remove, requestHost, requestApproval };
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

describe("project tools", () => {
  it("asks before creating a project and sends its folders", async () => {
    const { create, requestHost, requestApproval } = setup();

    const result = await run(create, {
      name: " Site ",
      folders: [{ path: "/code/site" }, { path: "/docs", readOnly: true }],
    });

    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "ui_project_create",
        subject: "Create project “Site”",
        evidence: "Folders:\n/code/site\n/docs (read-only)",
      }),
    );
    expect(requestHost).toHaveBeenCalledWith({
      kind: "project",
      operation: {
        op: "create",
        name: "Site",
        folders: [
          { path: "/code/site", access: "read-write" },
          { path: "/docs", access: "read-only" },
        ],
      },
    });
    expect(text(result)).toContain("Created project Site (id: p-new).");
  });

  it("creates nothing when the user declines", async () => {
    const { create, requestHost } = setup({ kind: "deny", reason: "No." });

    const result = await run(create, {
      name: "Site",
      folders: [{ path: "/code/site" }],
    });

    expect(requestHost).not.toHaveBeenCalled();
    expect(result.details).toEqual({ done: false });
    expect(text(result)).toContain("No.");
  });

  it("lists the changes and says when the own project changes later", async () => {
    const { update, requestApproval } = setup();

    const result = await run(update, {
      projectId: "p-current",
      name: "Pine 2",
      addFolders: [{ path: "/code/shared", readOnly: true }],
      removeFolders: ["/code/old"],
    });

    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Edit project “Pine”",
        evidence:
          "Name: Pine → Pine 2\nAdd /code/shared (read-only)\nRemove /code/old",
      }),
    );
    expect(text(result)).toContain("will be saved when this reply ends");
  });

  it("refuses an edit that changes nothing", async () => {
    const { update, requestApproval } = setup();

    await expect(
      run(update, { projectId: "p-other", name: "Notes" }),
    ).rejects.toThrow("Nothing to change.");
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("never deletes the project the session runs in", async () => {
    const { remove, requestApproval } = setup();

    await expect(run(remove, { projectId: "p-current" })).rejects.toThrow(
      "cannot delete the project it runs in",
    );
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("deletes another project after the user approves", async () => {
    const { remove, requestHost, requestApproval } = setup();

    const result = await run(remove, { projectId: "p-other" });

    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Delete project “Notes” permanently",
        evidence:
          "All of its sessions are deleted. Its folders stay on disk:\n/notes",
      }),
    );
    expect(requestHost).toHaveBeenLastCalledWith({
      kind: "project",
      operation: { op: "delete", projectId: "p-other" },
    });
    expect(text(result)).toBe("Deleted project Notes.");
  });
});
