import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PineCore } from "../../pineCore";
import type { PineProject } from "../../../../shared/projects";
import { TEMPORARY_WORKSPACE_PROJECT_ID } from "../../../../shared/projects";
import { LIST_ALL_RECENT_SESSIONS_CHANNEL } from "../../../../shared/sessions";
import {
  answerSessionOperation,
  registerSessionRequests,
  startBackgroundSession,
} from "../sessions";

const searchAllSessions = vi.hoisted(() => vi.fn());
const listProjectSessions = vi.hoisted(() => vi.fn());
const listAllRecentSessions = vi.hoisted(() => vi.fn());
vi.mock("../../../recentSessions", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  searchAllSessions,
  listProjectSessions,
  listAllRecentSessions,
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
  sessionParents = {},
  activity = "idle",
  holders = undefined as number[] | undefined,
  sharing = [] as number[],
  inTemporaryWorkspace = false,
  relayRefusal = undefined as string | undefined,
  origin = undefined as "wechat" | "wechat-used" | undefined,
  ceilingMode = "YOLO",
}: {
  callerMode?: string;
  owner?: number;
  open?: boolean;
  live?: string[];
  sessionParents?: Record<string, string>;
  activity?: string;
  holders?: number[];
  sharing?: number[];
  inTemporaryWorkspace?: boolean;
  relayRefusal?: string;
  origin?: "wechat" | "wechat-used";
  ceilingMode?: string;
} = {}) {
  const projects = [
    {
      ...project(projectId, "Pine"),
      sessionGroups: [
        { id: "g1", name: "Release", sessionIds: [filedSession, "gone"] },
      ],
      sessionParents,
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
  const isOpen = vi.fn<(clientId: number) => boolean>(() => open);
  const clientsSharingRuntime = vi.fn().mockReturnValue(sharing);
  const notifyLibraryChanged = vi.fn();
  const notifySessionsDeleted = vi.fn();
  const updateSessionParents = vi.fn(
    (_id: string, change: (parents: Record<string, string>) => object) =>
      Promise.resolve({
        ...projects[0],
        sessionParents: change(sessionParents),
      }),
  );
  const loadMessages = vi.fn().mockResolvedValue({
    messages: [
      {
        role: "assistant",
        createdAt: "t",
        blocks: [{ type: "text", text: "Built it" }],
      },
    ],
    hasMore: true,
    nextBefore: "older",
  });
  const relayRefusalCheck = vi.fn().mockResolvedValue(relayRefusal);
  const sessionRelayed = vi.fn().mockResolvedValue(undefined);
  const core = {
    repository: {
      list: vi.fn().mockResolvedValue(projects),
      open: vi.fn().mockResolvedValue(projects[0]),
      dataPaths: vi.fn().mockReturnValue({}),
      get: vi.fn().mockResolvedValue(projects[0]),
      updateSessionGroups,
      updateSessionParents,
    },
    runtimes: {
      approvalModeOfLiveSession: vi.fn().mockReturnValue(callerMode),
      projectOfLiveSession: vi
        .fn()
        .mockReturnValue(projects[inTemporaryWorkspace ? 1 : 0]),
      ownerOfProject: vi.fn().mockReturnValue(owner),
      clientsOfProject: vi
        .fn()
        .mockReturnValue(holders ?? (owner === undefined ? [] : [owner])),
      clientsSharingRuntime,
      isOpen,
      openSessionService: vi.fn(),
      share,
      prompt,
      renameSession,
      deleteSession,
      liveSessionIdsOf: vi.fn().mockReturnValue(live),
      loadMessages,
    },
    sessionActivity: vi.fn().mockReturnValue(activity),
    automations: {
      runSessions: vi.fn().mockResolvedValue(new Map([["run", {}]])),
    },
    wechat: {
      originOf: vi.fn().mockReturnValue(origin),
      relayRefusal: relayRefusalCheck,
      sessionRelayed,
      status: vi.fn(() => ({ settings: { ceilingMode } })),
    },
    notifyLibraryChanged,
    notifySessionsDeleted,
  } as unknown as PineCore;
  return {
    core,
    prompt,
    share,
    updateSessionGroups,
    renameSession,
    deleteSession,
    updateSessionParents,
    loadMessages,
    notifySessionsDeleted,
    isOpen,
    clientsSharingRuntime,
    notifyLibraryChanged,
    relayRefusalCheck,
    sessionRelayed,
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
      relation: "sibling",
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
        relation: "sibling",
        message: "Go",
        approvalMode: "YOLO",
        locale: "en-US",
      }),
    ).rejects.toThrow("cannot start one in YOLO");
    expect(prompt).not.toHaveBeenCalled();
  });

  it("holds a WeChat-driven session to the current WeChat ceiling when it starts one", async () => {
    // The ceiling was lowered while the turn runs on in its old mode.
    const { core, prompt } = fixture({
      callerMode: "auto-approve",
      origin: "wechat",
      ceilingMode: "let-me-review",
    });

    await expect(
      answerSessionOperation(core, requester, {
        op: "start",
        relation: "child",
        message: "Go",
        approvalMode: "auto-approve",
        locale: "en-US",
      }),
    ).rejects.toThrow("WeChat's highest approval mode is let-me-review");
    expect(prompt).not.toHaveBeenCalled();
  });

  it("refuses a project another window holds", async () => {
    const { core, prompt } = fixture({ owner: 9 });

    await expect(
      answerSessionOperation(core, requester, {
        op: "start",
        relation: "sibling",
        projectId,
        message: "Go",
        approvalMode: "auto-approve",
        locale: "en-US",
      }),
    ).rejects.toThrow("another Pine window");
    expect(prompt).not.toHaveBeenCalled();
  });

  it("starts a sub-session in a window's own temporary workspace beside another window's", async () => {
    const { core, prompt } = fixture({
      holders: [7, 9],
      sharing: [],
      inTemporaryWorkspace: true,
    });

    await answerSessionOperation(core, requester, {
      op: "start",
      relation: "child",
      message: "Go",
      approvalMode: "auto-approve",
      locale: "en-US",
    });

    expect(prompt).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        target: { kind: "new", projectId: TEMPORARY_WORKSPACE_PROJECT_ID },
      }),
      expect.objectContaining({ focus: false }),
    );
  });

  it("starts beside a project only a virtual client holds", async () => {
    const { core, prompt } = fixture({ holders: [-2] });

    await answerSessionOperation(core, requester, {
      op: "start",
      relation: "sibling",
      projectId,
      message: "Go",
      approvalMode: "auto-approve",
      locale: "en-US",
    });

    expect(prompt).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ message: "Go" }),
      { focus: false },
    );
  });

  it("starts a virtual requester's session as the window sharing its runtime", async () => {
    const {
      core,
      prompt,
      share,
      isOpen,
      clientsSharingRuntime,
      notifyLibraryChanged,
    } = fixture({
      open: false,
      holders: [-2, 9],
      sharing: [9],
    });
    isOpen.mockImplementation((clientId: number) => clientId === 9);

    await answerSessionOperation(
      core,
      { ...requester, ownerId: -2 },
      {
        op: "start",
        relation: "sibling",
        projectId,
        message: "Go",
        approvalMode: "auto-approve",
        locale: "en-US",
      },
    );

    expect(share).toHaveBeenCalledWith(-2, expect.anything(), {});
    expect(clientsSharingRuntime).toHaveBeenCalledWith(-2, projectId);
    expect(prompt).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ message: "Go" }),
      { focus: false },
    );
    expect(notifyLibraryChanged).toHaveBeenCalledWith("sessions", 9);
  });

  it("starts a virtual requester's session as itself without a window", async () => {
    const { core, prompt } = fixture({ holders: [-2] });

    await answerSessionOperation(
      core,
      { ...requester, ownerId: -2 },
      {
        op: "start",
        relation: "sibling",
        projectId,
        message: "Go",
        approvalMode: "auto-approve",
        locale: "en-US",
      },
    );

    expect(prompt).toHaveBeenCalledWith(-2, expect.anything(), {
      focus: false,
    });
  });

  it("starts a background session: shares, then prompts without focus", async () => {
    const { core, prompt, share, notifyLibraryChanged } = fixture({
      open: false,
    });

    const result = await startBackgroundSession(core, {
      ownerId: -2,
      project: project(projectId, "Pine"),
      message: "Hello",
      approvalMode: "let-me-review",
      locale: "en-US",
    });

    expect(share).toHaveBeenCalledWith(-2, expect.anything(), {});
    expect(share.mock.invocationCallOrder[0]).toBeLessThan(
      prompt.mock.invocationCallOrder[0] ?? 0,
    );
    expect(prompt).toHaveBeenCalledWith(
      -2,
      {
        locale: "en-US",
        message: "Hello",
        target: { kind: "new", projectId },
        approvalMode: "let-me-review",
      },
      { focus: false },
    );
    expect(notifyLibraryChanged).toHaveBeenCalledWith("sessions", -2);
    expect(result).toMatchObject({ session: { id: "new-session" } });
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
      "agent",
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

  it("deletes an open session with its sub-sessions and closes their tabs", async () => {
    const { core, deleteSession, notifySessionsDeleted } = fixture({
      live: [filedSession, looseSession],
      sessionParents: { [looseSession]: filedSession },
    });

    await answerSessionOperation(core, requester, {
      op: "delete",
      projectId,
      sessionId: filedSession,
    });

    expect(deleteSession).toHaveBeenCalledWith(7, projectId, looseSession);
    expect(deleteSession).toHaveBeenCalledWith(7, projectId, filedSession);
    expect(notifySessionsDeleted).toHaveBeenCalledWith([
      filedSession,
      looseSession,
    ]);
  });

  it("starts a sub-session and links it to its parent", async () => {
    const { core, prompt, updateSessionParents } = fixture();

    const result = await answerSessionOperation(core, requester, {
      op: "start",
      relation: "child",
      message: "Fix it",
      approvalMode: "auto-approve",
      locale: "en-US",
    });

    expect(prompt.mock.calls[0]?.[1].message).toMatch(
      /^\[Sub-session of 1111.*\]\n\nFix it$/,
    );
    expect(prompt.mock.calls[0]?.[2]).toEqual({
      focus: false,
      parentSessionId: requester.sessionId,
    });
    await expect(
      updateSessionParents.mock.results[0]?.value,
    ).resolves.toMatchObject({
      sessionParents: { "new-session": requester.sessionId },
    });
    expect(result).toMatchObject({ parentSessionId: requester.sessionId });
  });

  it("titles a session the agent named", async () => {
    const { core, renameSession } = fixture();

    await answerSessionOperation(core, requester, {
      op: "start",
      relation: "child",
      title: "Check docs",
      message: "Read the docs",
      approvalMode: "auto-approve",
      locale: "en-US",
    });

    expect(renameSession).toHaveBeenCalledWith(
      7,
      projectId,
      "new-session",
      "Check docs",
      "agent",
    );
  });

  it("refuses a sub-session of a sub-session", async () => {
    const { core, prompt } = fixture({
      sessionParents: { [requester.sessionId]: filedSession },
    });

    await expect(
      answerSessionOperation(core, requester, {
        op: "start",
        relation: "child",
        message: "Deeper",
        approvalMode: "auto-approve",
        locale: "en-US",
      }),
    ).rejects.toThrow("one level deep");
    expect(prompt).not.toHaveBeenCalled();
  });

  it("starts a sibling of a sub-session under the same parent", async () => {
    const { core, prompt } = fixture({
      sessionParents: { [requester.sessionId]: filedSession },
    });

    await answerSessionOperation(core, requester, {
      op: "start",
      relation: "sibling",
      message: "Also",
      approvalMode: "auto-approve",
      locale: "en-US",
    });

    expect(prompt.mock.calls[0]?.[2]).toEqual({
      focus: false,
      parentSessionId: filedSession,
    });
  });

  it("lists a sub-session's parent and siblings", async () => {
    const { core } = fixture({
      sessionParents: {
        [requester.sessionId]: filedSession,
        [looseSession]: filedSession,
      },
    });

    const result = await answerSessionOperation(core, requester, {
      op: "relatives",
    });

    expect(result).toEqual({
      op: "relatives",
      parent: {
        id: filedSession,
        title: "Filed",
        state: "idle",
        updatedAt: "u1",
      },
      children: [],
      siblings: [
        { id: looseSession, title: "Loose", state: "idle", updatedAt: "u2" },
      ],
    });
  });

  it("reads a relative's messages as text", async () => {
    const { core, loadMessages } = fixture({
      sessionParents: { [looseSession]: requester.sessionId },
    });

    const result = await answerSessionOperation(core, requester, {
      op: "read",
      sessionId: looseSession,
      limit: 5,
    });

    expect(loadMessages).toHaveBeenCalledWith(
      7,
      projectId,
      looseSession,
      undefined,
      5,
    );
    expect(result).toEqual({
      op: "read",
      sessionId: looseSession,
      title: "Loose",
      messages: [{ role: "assistant", createdAt: "t", text: "Built it" }],
      olderCursor: "older",
    });
  });

  it("reads any session of a project once the tool passes its project", async () => {
    const { core, loadMessages } = fixture();

    const result = await answerSessionOperation(core, requester, {
      op: "read",
      sessionId: looseSession,
      projectId,
      limit: 5,
    });

    expect(loadMessages).toHaveBeenCalledWith(
      7,
      projectId,
      looseSession,
      undefined,
      5,
    );
    expect(result).toMatchObject({ op: "read", sessionId: looseSession });
  });

  it("refuses to read or message a session that is not a relative", async () => {
    const { core, prompt } = fixture();

    await expect(
      answerSessionOperation(core, requester, {
        op: "send",
        sessionId: looseSession,
        message: "Hi",
        locale: "en-US",
      }),
    ).rejects.toThrow("not this session's parent");
    expect(prompt).not.toHaveBeenCalled();
  });

  it("refuses a WeChat-driven session's message to a relative above the ceiling", async () => {
    const { core, prompt, relayRefusalCheck } = fixture({
      sessionParents: { [requester.sessionId]: looseSession },
      relayRefusal:
        "This session is driven from WeChat; that session runs above",
    });

    await expect(
      answerSessionOperation(core, requester, {
        op: "send",
        sessionId: looseSession,
        message: "Deploy it",
        locale: "en-US",
      }),
    ).rejects.toThrow("driven from WeChat");
    expect(relayRefusalCheck).toHaveBeenCalledWith(
      requester.sessionId,
      looseSession,
      projectId,
    );
    expect(prompt).not.toHaveBeenCalled();
  });

  it("marks the relative a WeChat-driven session sends work to", async () => {
    const { core, prompt, sessionRelayed } = fixture({
      sessionParents: { [looseSession]: requester.sessionId },
      origin: "wechat",
    });

    await answerSessionOperation(core, requester, {
      op: "send",
      sessionId: looseSession,
      message: "Carry on",
      locale: "en-US",
    });

    expect(sessionRelayed).toHaveBeenCalledWith(
      requester.sessionId,
      looseSession,
      projectId,
    );
    expect(sessionRelayed.mock.invocationCallOrder[0]).toBeLessThan(
      prompt.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("steers a message into a running sub-session", async () => {
    const { core, prompt } = fixture({
      sessionParents: { [looseSession]: requester.sessionId },
      activity: "running",
    });

    const result = await answerSessionOperation(core, requester, {
      op: "send",
      sessionId: looseSession,
      message: "Stop there",
      locale: "en-US",
    });

    expect(prompt.mock.calls[0]?.[1]).toMatchObject({
      message: `[Message from session (${requester.sessionId})]\n\nStop there`,
      target: { kind: "session", projectId, sessionId: looseSession },
      streamingBehavior: "steer",
    });
    expect(result).toEqual({ op: "send", delivered: "steer" });
  });
});

describe("session lists", () => {
  it("mark sessions started or used from WeChat beside automation runs", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const run = { automationId: "a", runId: "r" };
    const core = {
      repository: { list: vi.fn().mockResolvedValue([]) },
      runtimes: {},
      automations: {
        runSessions: vi.fn().mockResolvedValue(new Map([["run", run]])),
      },
      wechat: {
        originOf: vi.fn((id: string) =>
          id === "started"
            ? "wechat"
            : id === "used" || id === "run"
              ? "wechat-used"
              : undefined,
        ),
      },
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
    } as unknown as PineCore;
    const summary = (id: string) => ({
      id,
      projectId,
      createdAt: "c",
      updatedAt: "u",
      messageCount: 1,
    });
    listAllRecentSessions.mockResolvedValue(
      ["started", "used", "run", "plain"].map(summary),
    );
    registerSessionRequests(core);

    const result = (await handlers.get(LIST_ALL_RECENT_SESSIONS_CHANNEL)?.(
      { clientId: 7 },
      undefined,
    )) as { sessions: unknown[] };

    expect(result.sessions).toEqual([
      { ...summary("started"), origin: "wechat" },
      { ...summary("used"), origin: "wechat-used" },
      { ...summary("run"), automationRun: run, origin: "wechat-used" },
      summary("plain"),
    ]);
  });
});
