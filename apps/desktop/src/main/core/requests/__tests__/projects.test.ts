import { describe, expect, it, vi } from "vitest";
import type { PineCore } from "../../pineCore";
import type { PineProject } from "../../../../shared/projects";
import { TEMPORARY_WORKSPACE_PROJECT_ID } from "../../../../shared/projects";
import { answerProjectOperation } from "../projects";

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
  const remove = vi.fn().mockResolvedValue(true);
  const closeEverywhere = vi.fn().mockResolvedValue(undefined);
  const core = {
    repository: {
      get: vi.fn((id: string) => Promise.resolve(projects.get(id))),
      create,
      update,
      delete: remove,
      dataPaths: vi.fn().mockReturnValue({}),
    },
    runtimes: {
      projectOfLiveSession: vi.fn().mockReturnValue(projects.get(ownId)),
      liveSessionIdsOf: vi.fn().mockReturnValue([]),
      clientsOfProject: vi.fn().mockReturnValue([7]),
      refresh: vi.fn().mockResolvedValue(undefined),
      closeEverywhere,
    },
    projectHasRunningWork: vi.fn().mockReturnValue(busy),
    scheduleAfterReply,
    sendSessionEvent: vi.fn(),
    notifyLibraryChanged: vi.fn(),
  } as unknown as PineCore;
  return { core, update, scheduleAfterReply, create, remove, closeEverywhere };
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
});
