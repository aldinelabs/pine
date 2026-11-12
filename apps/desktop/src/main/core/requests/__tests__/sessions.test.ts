import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PineCore } from "../../pineCore";
import type { PineProject } from "../../../../shared/projects";
import { TEMPORARY_WORKSPACE_PROJECT_ID } from "../../../../shared/projects";
import { answerSessionOperation } from "../sessions";

const searchAllSessions = vi.hoisted(() => vi.fn());
vi.mock("../../../recentSessions", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  searchAllSessions,
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

function fixture({ callerMode = "auto-approve", owner = 7, open = true } = {}) {
  const projects = [
    project(projectId, "Pine"),
    project(TEMPORARY_WORKSPACE_PROJECT_ID, "Temporary"),
  ];
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
    },
    runtimes: {
      approvalModeOfLiveSession: vi.fn().mockReturnValue(callerMode),
      projectOfLiveSession: vi.fn().mockReturnValue(projects[0]),
      ownerOfProject: vi.fn().mockReturnValue(owner),
      isOpen: vi.fn().mockReturnValue(open),
      openSessionService: vi.fn(),
      share,
      prompt,
    },
    automations: {
      runSessions: vi.fn().mockResolvedValue(new Map([["run", {}]])),
    },
    notifyLibraryChanged: vi.fn(),
  } as unknown as PineCore;
  return { core, prompt, share };
}

beforeEach(() => searchAllSessions.mockReset());

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
});
