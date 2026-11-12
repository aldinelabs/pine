import { describe, expect, it, vi } from "vitest";
import type { PineCore } from "../../pineCore";
import type {
  PineProject,
  ProjectHostOperation,
} from "../../../../shared/projects";
import { TEMPORARY_WORKSPACE_PROJECT_ID } from "../../../../shared/projects";
import { agentHostProject, answerProjectOperation } from "../projects";

const ownId = "22222222-2222-4222-8222-222222222222";
const otherId = "66666666-6666-4666-8666-666666666666";
const keptFolder = "77777777-7777-4777-8777-777777777777";
const requester = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  ownerId: 7,
};

function project(id: string, name: string): PineProject {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    defaultFolderId: keptFolder,
    folders: [
      {
        id: keptFolder,
        name: "app",
        path: "/code/app",
        access: "read-write",
        isAvailable: true,
      },
    ],
    id,
    name,
    projectIcon: "inbox",
    schemaVersion: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function fixture({ busy = false } = {}) {
  const projects = new Map([
    [ownId, project(ownId, "Pine")],
    [otherId, project(otherId, "Notes")],
  ]);
  const update = vi.fn((id: string, input: { name: string }) =>
    Promise.resolve({ ...projects.get(id), name: input.name }),
  );
  const scheduleAfterReply = vi.fn();
  const create = vi.fn((input: { name: string }) =>
    Promise.resolve({ ...project("new", input.name) }),
  );
  const updateAppearance = vi.fn((id: string, appearance: object) => {
    const saved = { ...projects.get(id), ...appearance } as PineProject;
    projects.set(id, saved);
    return Promise.resolve(saved);
  });
  const refresh = vi.fn().mockResolvedValue(undefined);
  const remove = vi.fn().mockResolvedValue(true);
  const closeEverywhere = vi.fn().mockResolvedValue(undefined);
  const notifyLibraryChanged = vi.fn();
  const core = {
    repository: {
      get: vi.fn((id: string) => Promise.resolve(projects.get(id))),
      create,
      update,
      updateAppearance,
      delete: remove,
      dataPaths: vi.fn().mockReturnValue({}),
    },
    runtimes: {
      projectOfLiveSession: vi.fn().mockReturnValue(projects.get(ownId)),
      liveSessionIdsOf: vi.fn().mockReturnValue([]),
      clientsOfProject: vi.fn().mockReturnValue([7]),
      refresh,
      closeEverywhere,
    },
    projectHasRunningWork: vi.fn().mockReturnValue(busy),
    scheduleAfterReply,
    sendSessionEvent: vi.fn(),
    notifyLibraryChanged,
  } as unknown as PineCore;
  return {
    core,
    notifyLibraryChanged,
    update,
    updateAppearance,
    refresh,
    scheduleAfterReply,
    create,
    remove,
    closeEverywhere,
  };
}

describe("answerProjectOperation", () => {
  it("creates a project whose default is the first read-write folder", async () => {
    const { core, create } = fixture();

    await answerProjectOperation(core, requester, {
      op: "create",
      name: "Site",
      folders: [
        { path: "/docs", access: "read-only" },
        { path: "/code/site/", access: "read-write" },
      ],
    });

    const input = create.mock.calls[0]?.[0] as unknown as {
      defaultFolderId: string;
      folders: { id: string; name: string; path: string }[];
    };
    expect(input?.folders.map((folder) => [folder.path, folder.name])).toEqual([
      ["/docs", "docs"],
      ["/code/site", "site"],
    ]);
    expect(input?.defaultFolderId).toBe(input?.folders[1]?.id);
  });

  it("refuses a relative folder path", async () => {
    const { core } = fixture();

    await expect(
      answerProjectOperation(core, requester, {
        op: "create",
        name: "Site",
        folders: [{ path: "site", access: "read-write" }],
      }),
    ).rejects.toThrow("not an absolute path");
  });

  it("changes the own project only after the reply ends", async () => {
    const { core, update, scheduleAfterReply } = fixture();

    const result = await answerProjectOperation(core, requester, {
      op: "update",
      projectId: ownId,
      name: "Pine 2",
      addFolders: [{ path: "/code/lib", access: "read-only" }],
    });

    expect(result).toMatchObject({ applied: "after-reply" });
    expect(update).not.toHaveBeenCalled();
    await (scheduleAfterReply.mock.calls[0]?.[1] as () => Promise<void>)();
    expect(update).toHaveBeenCalledWith(
      ownId,
      expect.objectContaining({
        name: "Pine 2",
        defaultFolderId: keptFolder,
        folders: [
          expect.objectContaining({ id: keptFolder, path: "/code/app" }),
          expect.objectContaining({ path: "/code/lib", access: "read-only" }),
        ],
      }),
    );
  });

  it("moves the default when its folder is removed", async () => {
    const { core, update } = fixture();

    await answerProjectOperation(core, requester, {
      op: "update",
      projectId: otherId,
      addFolders: [{ path: "/code/next", access: "read-write" }],
      removeFolderPaths: ["/code/app/"],
    });

    const input = update.mock.calls[0]?.[1] as unknown as {
      defaultFolderId: string;
      folders: { id: string; path: string }[];
    };
    expect(input.folders.map((folder) => folder.path)).toEqual(["/code/next"]);
    expect(input.defaultFolderId).toBe(input.folders[0]?.id);
  });

  it("refuses to restart other running work", async () => {
    const { core, update } = fixture({ busy: true });

    await expect(
      answerProjectOperation(core, requester, {
        op: "update",
        projectId: otherId,
        name: "Notes 2",
      }),
    ).rejects.toThrow("still working");
    expect(update).not.toHaveBeenCalled();
  });

  it("never deletes the own project or No Project", async () => {
    const { core, remove } = fixture();

    await expect(
      answerProjectOperation(core, requester, {
        op: "delete",
        projectId: ownId,
      }),
    ).rejects.toThrow("cannot delete the project it runs in");
    await expect(
      answerProjectOperation(core, requester, {
        op: "delete",
        projectId: TEMPORARY_WORKSPACE_PROJECT_ID,
      }),
    ).rejects.toThrow("No Project");
    expect(remove).not.toHaveBeenCalled();
  });

  it("closes and deletes another project", async () => {
    const { core, remove, closeEverywhere } = fixture();

    const result = await answerProjectOperation(core, requester, {
      op: "delete",
      projectId: otherId,
    });

    expect(closeEverywhere).toHaveBeenCalledWith(otherId);
    expect(remove).toHaveBeenCalledWith(otherId);
    expect(result).toEqual({ op: "delete", projectName: "Notes" });
  });

  it("creates a project with the given icon and accent color", async () => {
    const { core, create } = fixture();

    await answerProjectOperation(core, requester, {
      op: "create",
      name: "Site",
      folders: [{ path: "/code/site", access: "read-write" }],
      projectIcon: "rocket",
      projectColorTheme: "violet",
    });
    await answerProjectOperation(core, requester, {
      op: "create",
      name: "Plain",
      folders: [{ path: "/code/plain", access: "read-write" }],
    });

    expect(create.mock.calls[0]?.[0]).toMatchObject({
      projectIcon: "rocket",
      projectColorTheme: "violet",
    });
    const plain = create.mock.calls[1]?.[0] as unknown as Record<
      string,
      unknown
    >;
    expect(plain.projectColorTheme).toBe("default");
    expect(plain).not.toHaveProperty("projectIcon");
  });

  it("changes the own project's appearance at once without restarting", async () => {
    const {
      core,
      update,
      updateAppearance,
      refresh,
      scheduleAfterReply,
      notifyLibraryChanged,
    } = fixture();

    const result = await answerProjectOperation(core, requester, {
      op: "update",
      projectId: ownId,
      projectIcon: "rocket",
      projectColorTheme: "blue",
    });

    expect(updateAppearance).toHaveBeenCalledWith(ownId, {
      projectIcon: "rocket",
      projectColorTheme: "blue",
    });
    expect(result).toEqual({
      op: "update",
      projectId: ownId,
      projectName: "Pine",
      applied: "now",
    });
    expect(update).not.toHaveBeenCalled();
    expect(scheduleAfterReply).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(notifyLibraryChanged).toHaveBeenCalledWith("projects");
  });

  it("changes the appearance while another session is working", async () => {
    const { core, updateAppearance } = fixture({ busy: true });

    await answerProjectOperation(core, requester, {
      op: "update",
      projectId: otherId,
      name: "Notes",
      defaultFolderPath: "/code/app/",
      projectIcon: "rocket",
    });

    expect(updateAppearance).toHaveBeenCalledWith(otherId, {
      projectIcon: "rocket",
    });
  });

  it("applies the icon of an own-project rename at once and defers the rename", async () => {
    const { core, update, updateAppearance, scheduleAfterReply } = fixture();

    const result = await answerProjectOperation(core, requester, {
      op: "update",
      projectId: ownId,
      name: "Pine 2",
      projectIcon: "rocket",
    });

    expect(result).toMatchObject({ applied: "after-reply" });
    expect(updateAppearance).toHaveBeenCalledWith(ownId, {
      projectIcon: "rocket",
    });
    expect(update).not.toHaveBeenCalled();
    await (scheduleAfterReply.mock.calls[0]?.[1] as () => Promise<void>)();
    expect(update).toHaveBeenCalledWith(
      ownId,
      expect.objectContaining({
        name: "Pine 2",
        projectIcon: "rocket",
        projectColorTheme: "default",
      }),
    );
  });

  it("keeps an appearance saved while an own-project rename waits", async () => {
    const { core, update, scheduleAfterReply } = fixture();

    await answerProjectOperation(core, requester, {
      op: "update",
      projectId: ownId,
      name: "Pine 2",
    });
    await answerProjectOperation(core, requester, {
      op: "update",
      projectId: ownId,
      projectIcon: "rocket",
      projectColorTheme: "blue",
    });
    await (scheduleAfterReply.mock.calls[0]?.[1] as () => Promise<void>)();

    expect(update).toHaveBeenCalledWith(
      ownId,
      expect.objectContaining({
        name: "Pine 2",
        projectIcon: "rocket",
        projectColorTheme: "blue",
      }),
    );
  });

  it("keeps a later icon over one sent with a deferred rename", async () => {
    const { core, update, scheduleAfterReply } = fixture();

    await answerProjectOperation(core, requester, {
      op: "update",
      projectId: ownId,
      name: "Pine 2",
      projectIcon: "rocket",
    });
    await answerProjectOperation(core, requester, {
      op: "update",
      projectId: ownId,
      projectIcon: "star",
    });
    await (scheduleAfterReply.mock.calls[0]?.[1] as () => Promise<void>)();

    expect(update).toHaveBeenCalledWith(
      ownId,
      expect.objectContaining({ name: "Pine 2", projectIcon: "star" }),
    );
  });

  it("refuses an update that changes nothing", async () => {
    const { core, update, updateAppearance } = fixture();

    await expect(
      answerProjectOperation(core, requester, {
        op: "update",
        projectId: otherId,
        name: "Notes",
      }),
    ).rejects.toThrow("Nothing to change.");
    expect(update).not.toHaveBeenCalled();
    expect(updateAppearance).not.toHaveBeenCalled();
  });

  it("rejects icons and colors the Edit Project dialog does not offer", async () => {
    const { core, create, update, updateAppearance } = fixture();
    const invalid = [
      {
        op: "create",
        name: "Site",
        folders: [{ path: "/code/site", access: "read-write" }],
        projectIcon: "dragon",
      },
      {
        op: "create",
        name: "Site",
        folders: [{ path: "/code/site", access: "read-write" }],
        projectColorTheme: "pink",
      },
      { op: "update", projectId: otherId, projectIcon: "dragon" },
      { op: "update", projectId: otherId, projectColorTheme: "pink" },
    ] as unknown as ProjectHostOperation[];

    for (const operation of invalid)
      await expect(
        answerProjectOperation(core, requester, operation),
      ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(updateAppearance).not.toHaveBeenCalled();
  });
});

describe("agentHostProject", () => {
  it("maps the icon and accent color and marks the current project", () => {
    expect(
      agentHostProject(
        {
          ...project(ownId, "Pine"),
          projectIcon: "rocket",
          projectColorTheme: "blue",
        },
        ownId,
      ),
    ).toEqual({
      id: ownId,
      name: "Pine",
      current: true,
      defaultFolderPath: "/code/app",
      folders: [{ access: "read-write", name: "app", path: "/code/app" }],
      icon: "rocket",
      accentColor: "blue",
    });
  });

  it("falls back to Pine's defaults", () => {
    const bare = project(otherId, "Notes");
    delete bare.projectIcon;

    expect(agentHostProject(bare, ownId)).toMatchObject({
      icon: "inbox",
      accentColor: "default",
    });
    expect(agentHostProject(bare, ownId)).not.toHaveProperty("current");
  });
});
