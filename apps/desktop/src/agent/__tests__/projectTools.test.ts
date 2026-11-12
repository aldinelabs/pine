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
import {
  PROJECT_COLOR_THEME_SETTINGS,
  PROJECT_ICONS,
} from "../../shared/projects";
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
    icon: "code" as const,
    accentColor: "default" as const,
  },
  {
    id: "p-other",
    name: "Notes",
    defaultFolderPath: "/notes",
    folders: [{ access: "read-write" as const, name: "notes", path: "/notes" }],
    icon: "notebook-pen" as const,
    accentColor: "blue" as const,
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

  it("refuses a working directory or folder the project already has", async () => {
    const { update, requestApproval } = setup();

    await expect(
      run(update, { projectId: "p-other", defaultFolder: "/notes/" }),
    ).rejects.toThrow("Nothing to change.");
    await expect(
      run(update, { projectId: "p-other", addFolders: [{ path: "/notes" }] }),
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

  it("offers the Edit Project dialog's icons and accent colors as plain enums", () => {
    const { create, update } = setup();

    for (const tool of [create, update]) {
      const properties = (
        tool.parameters as unknown as {
          properties: Record<string, { type?: string; enum?: string[] }>;
        }
      ).properties;
      expect(properties.icon).toMatchObject({
        type: "string",
        enum: [...PROJECT_ICONS],
      });
      expect(properties.accentColor).toMatchObject({
        type: "string",
        enum: [...PROJECT_COLOR_THEME_SETTINGS],
      });
    }
  });

  it("creates a project with an icon and accent color", async () => {
    const { create, requestHost, requestApproval } = setup();

    await run(create, {
      name: "Site",
      folders: [{ path: "/code/site" }],
      icon: "rocket",
      accentColor: "violet",
    });

    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: "Folders:\n/code/site\nIcon: rocket\nAccent color: Violet",
      }),
    );
    expect(requestHost).toHaveBeenLastCalledWith({
      kind: "project",
      operation: {
        op: "create",
        name: "Site",
        folders: [{ path: "/code/site", access: "read-write" }],
        projectIcon: "rocket",
        projectColorTheme: "violet",
      },
    });
  });

  it("lists an appearance change and sends only the appearance", async () => {
    const { update, requestHost, requestApproval } = setup();

    await run(update, {
      projectId: "p-current",
      icon: "rocket",
      accentColor: "blue",
    });

    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: "Icon: code → rocket\nAccent color: Pine Default → Blue",
      }),
    );
    expect(requestHost).toHaveBeenLastCalledWith({
      kind: "project",
      operation: {
        op: "update",
        projectId: "p-current",
        projectIcon: "rocket",
        projectColorTheme: "blue",
      },
    });
  });

  it("refuses an appearance edit that matches the current one", async () => {
    const { update, requestApproval } = setup();

    await expect(
      run(update, {
        projectId: "p-other",
        icon: "notebook-pen",
        accentColor: "blue",
      }),
    ).rejects.toThrow("Nothing to change.");
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("rejects unknown icons and accent colors before asking", async () => {
    const { create, update, requestApproval } = setup();

    await expect(
      run(create, {
        name: "Site",
        folders: [{ path: "/code/site" }],
        icon: "dragon",
      }),
    ).rejects.toThrow('Unknown icon "dragon". Use one of: inbox,');
    await expect(
      run(update, { projectId: "p-other", accentColor: "pink" }),
    ).rejects.toThrow('Unknown accent color "pink". Use one of: default,');
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
