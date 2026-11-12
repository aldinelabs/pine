import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PineCore } from "../../pineCore";
import type { PineProject } from "../../../../shared/projects";
import { TEMPORARY_WORKSPACE_PROJECT_ID } from "../../../../shared/projects";
import { answerSessionOperation } from "../sessions";

const searchAllSessions = vi.hoisted(() => vi.fn());
const listProjectSessions = vi.hoisted(() => vi.fn());
vi.mock("../../../recentSessions", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  searchAllSessions,
  listProjectSessions,
}));

const projectId = "22222222-2222-4222-8222-222222222222";
const requester = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  ownerId: 7,
};

function project(id: string, name: string): PineProject {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    defaultFolderId: "f",
    folders: [],
    id,
    name,
    schemaVersion: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const filedSession = "33333333-3333-4333-8333-333333333333";
const looseSession = "44444444-4444-4444-8444-444444444444";

function fixture({
  callerMode = "auto-approve",
  owner = 7,
  open = true,
  live = [] as string[],
} = {}) {
  const projects = [
    {
      ...project(projectId, "Pine"),
      sessionGroups: [
        { id: "g1", name: "Release", sessionIds: [filedSession, "gone"] },
      ],
    },
    project(TEMPORARY_WORKSPACE_PROJECT_ID, "Temporary"),
  ];
  const updateSessionGroups = vi.fn(
    (_id: string, sessionGroups: PineProject["sessionGroups"]) =>
      Promise.resolve({
        ...projects[0],
        sessionGroups,
        updatedAt: "2026-01-02T00:00:00.000Z",
      }),
  );
  const renameSession = vi.fn().mockResolvedValue({});
  const deleteSession = vi.fn().mockResolvedValue(true);
  const prompt = vi.fn().mockResolvedValue({
    accepted: true,
    session: { id: "new-session" },
  });
  const share = vi.fn().mockResolvedValue(undefined);
  const core = {
    repository: {
      list: vi.fn().mockResolvedValue(projects),
      open: vi.fn().mockResolvedValue(projects[0]),
      dataPaths: vi.fn().mockReturnValue({}),
      updateSessionGroups,
    },
    runtimes: {
      approvalModeOfLiveSession: vi.fn().mockReturnValue(callerMode),
      projectOfLiveSession: vi.fn().mockReturnValue(projects[0]),
      ownerOfProject: vi.fn().mockReturnValue(owner),
      isOpen: vi.fn().mockReturnValue(open),
      openSessionService: vi.fn(),
      share,
      prompt,
      renameSession,
      deleteSession,
      liveSessionIdsOf: vi.fn().mockReturnValue(live),
    },
    automations: {
      runSessions: vi.fn().mockResolvedValue(new Map([["run", {}]])),
    },
    notifyLibraryChanged: vi.fn(),
  } as unknown as PineCore;
  return {
    core,
    prompt,
    share,
    updateSessionGroups,
    renameSession,
    deleteSession,
  };
}

beforeEach(() => {
  searchAllSessions.mockReset();
  listProjectSessions.mockReset();
  listProjectSessions.mockResolvedValue([
    {
      id: looseSession,
      name: "Loose",
      createdAt: "c",
      updatedAt: "u2",
      messageCount: 2,
    },
    {
      id: filedSession,
      name: "Filed",
      createdAt: "c",
      updatedAt: "u1",
      messageCount: 4,
    },
  ]);
});

describe("answerSessionOperation", () => {
  it("searches every project and names No Project", async () => {
    const { core } = fixture();
    searchAllSessions.mockResolvedValue([
      {
        id: requester.sessionId,
        projectId,
        name: "Notes",
        snippet: "the \u0001build\u0002 failed",
        createdAt: "c",
        updatedAt: "u",
        messageCount: 3,
      },
      {
        id: "run",
        projectId: TEMPORARY_WORKSPACE_PROJECT_ID,
        preview: "nightly",
        createdAt: "c",
        updatedAt: "u",
        messageCount: 1,
      },
    ]);

    const result = await answerSessionOperation(core, requester, {
      op: "search",
      query: "build",
      limit: 10,
    });

    expect(searchAllSessions.mock.calls[0]?.[0]).toHaveLength(2);
    expect(searchAllSessions.mock.calls[0]?.[3]).toBe(10);
    expect(result).toEqual({
      op: "search",
      sessions: [
        {
          id: requester.sessionId,
          projectId,
          projectName: "Pine",
          title: "Notes",
          snippet: "the build failed",
          createdAt: "c",
          updatedAt: "u",
          messageCount: 3,
          current: true,
        },
        {
          id: "run",
          projectId: TEMPORARY_WORKSPACE_PROJECT_ID,
          projectName: "No Project",
          snippet: "nightly",
          createdAt: "c",
          updatedAt: "u",
          messageCount: 1,
          automationRun: true,
        },
      ],
    });
  });

  it("starts a background session in the caller's project", async () => {
    const { core, prompt, share } = fixture({ open: false, owner: undefined });

    const result = await answerSessionOperation(core, requester, {
      op: "start",
      message: "Fix it",
      approvalMode: "auto-approve",
      locale: "zh-CN",
    });

    expect(share).toHaveBeenCalledOnce();
    expect(prompt).toHaveBeenCalledWith(
      7,
      {
        locale: "zh-CN",
        message: "Fix it",
        target: { kind: "new", projectId },
        approvalMode: "auto-approve",
      },
      { focus: false },
    );
    expect(result).toEqual({
      op: "start",
      sessionId: "new-session",
      projectId,
      projectName: "Pine",
      approvalMode: "auto-approve",
    });
  });

  it("refuses a less supervised mode than the caller's", async () => {
    const { core, prompt } = fixture({ callerMode: "autonomous" });

    await expect(
      answerSessionOperation(core, requester, {
        op: "start",
        message: "Go",
        approvalMode: "YOLO",
        locale: "en-US",
      }),
    ).rejects.toThrow("cannot start one in YOLO");
    expect(prompt).not.toHaveBeenCalled();
  });

  it("refuses a project another window holds", async () => {
    const { core, prompt } = fixture({ owner: 9 });

    await expect(
      answerSessionOperation(core, requester, {
        op: "start",
        projectId,
        message: "Go",
        approvalMode: "auto-approve",
        locale: "en-US",
      }),
    ).rejects.toThrow("another Pine window");
    expect(prompt).not.toHaveBeenCalled();
  });

  it("shows folders without sessions that no longer exist", async () => {
    const { core } = fixture();

    const result = await answerSessionOperation(core, requester, {
      op: "tree",
      limit: 10,
    });

    expect(result).toEqual({
      op: "tree",
      tree: {
        projectId,
        projectName: "Pine",
        revision: "2026-01-01T00:00:00.000Z",
        folders: [
          {
            id: "g1",
            name: "Release",
            sessions: [{ id: filedSession, title: "Filed", updatedAt: "u1" }],
          },
        ],
        unfiled: [{ id: looseSession, title: "Loose", updatedAt: "u2" }],
        moreUnfiled: 0,
      },
    });
  });

  it("applies edits in order and files into a new folder", async () => {
    const { core, updateSessionGroups, renameSession } = fixture();

    const result = await answerSessionOperation(core, requester, {
      op: "organize",
      projectId,
      revision: "2026-01-01T00:00:00.000Z",
      operations: [
        { op: "create-folder", name: "Drafts" },
        { op: "move", sessionId: looseSession, folderId: "new:1" },
        { op: "move", sessionId: filedSession, folderId: null },
        { op: "delete-folder", folderId: "g1" },
        { op: "rename-session", sessionId: looseSession, name: "Plan" },
      ],
    });

    const groups = updateSessionGroups.mock.calls[0]?.[1];
    expect(groups).toEqual([
      { id: expect.any(String), name: "Drafts", sessionIds: [looseSession] },
    ]);
    expect(renameSession).toHaveBeenCalledWith(
      7,
      projectId,
      looseSession,
      "Plan",
    );
    expect(result).toMatchObject({
      op: "organize",
      createdFolderIds: [groups?.[0]?.id],
    });
  });

  it("refuses edits against a stale tree", async () => {
    const { core, updateSessionGroups } = fixture();

    await expect(
      answerSessionOperation(core, requester, {
        op: "organize",
        projectId,
        revision: "old",
        operations: [{ op: "create-folder", name: "Drafts" }],
      }),
    ).rejects.toThrow("changed since that tree was read");
    expect(updateSessionGroups).not.toHaveBeenCalled();
  });

  it("refuses a session of another project", async () => {
    const { core, updateSessionGroups } = fixture();

    await expect(
      answerSessionOperation(core, requester, {
        op: "organize",
        projectId,
        revision: "2026-01-01T00:00:00.000Z",
        operations: [
          {
            op: "move",
            sessionId: "55555555-5555-4555-8555-555555555555",
            folderId: "g1",
          },
        ],
      }),
    ).rejects.toThrow("No session");
    expect(updateSessionGroups).not.toHaveBeenCalled();
  });

  it("deletes a closed session and takes it out of its folder", async () => {
    const { core, deleteSession, updateSessionGroups } = fixture();

    const result = await answerSessionOperation(core, requester, {
      op: "delete",
      projectId,
      sessionId: filedSession,
    });

    expect(deleteSession).toHaveBeenCalledWith(7, projectId, filedSession);
    expect(updateSessionGroups.mock.calls[0]?.[1]).toEqual([
      { id: "g1", name: "Release", sessionIds: ["gone"] },
    ]);
    expect(result).toEqual({ op: "delete", deleted: true });
  });

  it("does not delete a session open in a tab", async () => {
    const { core, deleteSession } = fixture({ live: [filedSession] });

    await expect(
      answerSessionOperation(core, requester, {
        op: "delete",
        projectId,
        sessionId: filedSession,
      }),
    ).rejects.toThrow("close its tab first");
    expect(deleteSession).not.toHaveBeenCalled();
  });
});
