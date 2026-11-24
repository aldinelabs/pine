// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSISTANT_CLIENT_ID,
  ASSISTANT_PROJECT_ID,
} from "../../../shared/assistant";
import type { PineProject } from "../../../shared/projects";
import type { PineTextMessage } from "../../../shared/sessions";
import { AssistantService, ASSISTANT_WAKES_ON_REPORT } from "../assistant";
import type { PineCore } from "../pineCore";

const startBackgroundSession = vi.hoisted(() => vi.fn());
vi.mock("../requests/sessions", () => ({
  startBackgroundSession,
  sessionLibrary: () => ({}),
}));
const listProjectSessions = vi.hoisted(() => vi.fn());
vi.mock("../../recentSessions", () => ({ listProjectSessions }));

const ASSISTANT_SESSION = "11111111-1111-4111-8111-111111111111";
const DISPATCHED = "22222222-2222-4222-8222-222222222222";
const ELSEWHERE = "33333333-3333-4333-8333-333333333333";
const BLOG = "44444444-4444-4444-8444-444444444444";

const blog = {
  id: BLOG,
  name: "Blog",
  folders: [],
  defaultFolderId: "f",
} as unknown as PineProject;
const assistantProject = { id: ASSISTANT_PROJECT_ID } as PineProject;

function reply(text: string): PineTextMessage {
  return {
    role: "assistant",
    createdAt: "2026-11-24T00:00:00.000Z",
    blocks: [{ type: "text", text }],
  } as unknown as PineTextMessage;
}

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

beforeEach(() => {
  startBackgroundSession.mockReset();
  startBackgroundSession.mockResolvedValue({
    accepted: true,
    session: { id: DISPATCHED },
  });
  listProjectSessions.mockReset();
  listProjectSessions.mockResolvedValue([]);
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pine-assistant-core-"));
  roots.push(root);
  const live = new Map<string, PineProject>([
    [ASSISTANT_SESSION, assistantProject],
    [ELSEWHERE, blog],
  ]);
  const runtimes = {
    projectOfLiveSession: vi.fn((id: string) => live.get(id)),
    approvalModeOfLiveSession: vi.fn(() => "auto-approve"),
    isOpen: vi.fn(() => true),
    share: vi.fn(() => Promise.resolve()),
    clientsSharingRuntime: vi.fn(() => [ASSISTANT_CLIENT_ID]),
    ownerOfProject: vi.fn(() => 7),
    liveSessionIdsOf: vi.fn((projectId: string) =>
      projectId === ASSISTANT_PROJECT_ID ? [] : [DISPATCHED],
    ),
    summaryOfLiveSession: vi.fn(() => ({ name: "修首页" })),
    loadMessages: vi.fn(() =>
      Promise.resolve({ hasMore: false, messages: [reply("首页已修好。")] }),
    ),
    resume: vi.fn(() => Promise.resolve()),
  };
  const agentHost = {
    notifySession: vi.fn(() => Promise.resolve({ delivered: true })),
  };
  const core = {
    repository: {
      list: vi.fn(() => Promise.resolve([blog])),
      get: vi.fn((id: string) =>
        Promise.resolve(id === BLOG ? blog : assistantProject),
      ),
      open: vi.fn((id: string) =>
        Promise.resolve(id === BLOG ? blog : assistantProject),
      ),
      dataPaths: vi.fn(() => ({ projectRoot: root })),
    },
    runtimes,
    agentHost,
    sessionActivity: vi.fn(() => "running"),
  } as unknown as PineCore;
  return {
    root,
    core,
    runtimes,
    agentHost,
    service: new AssistantService(core),
  };
}

const dispatch = {
  op: "dispatch" as const,
  projectId: BLOG,
  title: "修首页",
  message: "修一下首页样式",
  approvalMode: "auto-approve" as const,
  locale: "zh-CN" as const,
};

describe("the Assistant's dispatches", () => {
  it("starts a top-level session in the project and remembers it", async () => {
    const { root, service } = await fixture();

    const result = await service.answer(
      { sessionId: ASSISTANT_SESSION, ownerId: ASSISTANT_CLIENT_ID },
      dispatch,
    );

    expect(result).toEqual({
      op: "dispatch",
      sessionId: DISPATCHED,
      projectId: BLOG,
      projectName: "Blog",
      approvalMode: "auto-approve",
    });
    const [, input] = startBackgroundSession.mock.calls[0] as [
      unknown,
      { project: PineProject; message: string; parentSessionId?: string },
    ];
    expect(input.project).toBe(blog);
    expect(input.parentSessionId).toBeUndefined();
    expect(input.message).toMatch(/^\[Dispatched by Pine's Assistant\./);
    expect(input.message).toContain("修一下首页样式");
    const stored = JSON.parse(
      await readFile(path.join(root, "dispatches.json"), "utf8"),
    ) as { dispatches: Record<string, { assistantSessionId: string }> };
    expect(stored.dispatches[DISPATCHED]?.assistantSessionId).toBe(
      ASSISTANT_SESSION,
    );
  });

  it("reports each turn of a dispatched session back to the Assistant", async () => {
    const { service, agentHost, runtimes } = await fixture();
    await service.answer(
      { sessionId: ASSISTANT_SESSION, ownerId: ASSISTANT_CLIENT_ID },
      dispatch,
    );

    await service.report(DISPATCHED, "finished");

    // The Assistant was not open, so it is resumed in the background first.
    expect(runtimes.resume).toHaveBeenCalledWith(
      ASSISTANT_CLIENT_ID,
      ASSISTANT_PROJECT_ID,
      ASSISTANT_SESSION,
      { focus: false },
    );
    expect(agentHost.notifySession).toHaveBeenCalledExactlyOnceWith(
      ASSISTANT_SESSION,
      {
        sessionId: DISPATCHED,
        projectId: BLOG,
        state: "finished",
        title: "修首页",
      },
      expect.stringContaining("<last-reply>首页已修好。</last-reply>"),
      { triggerTurn: ASSISTANT_WAKES_ON_REPORT },
    );
  });

  it("tells the Assistant a dispatched session waits, without its reply", async () => {
    const { service, agentHost } = await fixture();
    await service.answer(
      { sessionId: ASSISTANT_SESSION, ownerId: ASSISTANT_CLIENT_ID },
      dispatch,
    );

    await service.report(DISPATCHED, "awaiting-approval");

    const [, , content] = agentHost.notifySession.mock.calls[0] as unknown as [
      string,
      unknown,
      string,
    ];
    expect(content).not.toContain("<last-reply>");
    expect(content).toContain("never approve or reject it yourself");
  });

  it("says nothing about sessions it did not dispatch", async () => {
    const { service, agentHost } = await fixture();

    await service.report(ELSEWHERE, "finished");

    expect(agentHost.notifySession).not.toHaveBeenCalled();
  });

  it("answers no session but the Assistant's", async () => {
    const { service } = await fixture();

    await expect(
      service.answer({ sessionId: ELSEWHERE, ownerId: 7 }, { op: "overview" }),
    ).rejects.toThrow("Only Pine's Assistant can use this tool.");
    expect(startBackgroundSession).not.toHaveBeenCalled();
  });

  it("never dispatches above its own permission mode", async () => {
    const { service } = await fixture();

    await expect(
      service.answer(
        { sessionId: ASSISTANT_SESSION, ownerId: ASSISTANT_CLIENT_ID },
        { ...dispatch, approvalMode: "YOLO" },
      ),
    ).rejects.toThrow(/cannot dispatch a session in YOLO/);
    expect(startBackgroundSession).not.toHaveBeenCalled();
  });

  it("lists projects, running work and its dispatches in the overview", async () => {
    const { service } = await fixture();
    await service.answer(
      { sessionId: ASSISTANT_SESSION, ownerId: ASSISTANT_CLIENT_ID },
      dispatch,
    );

    const result = await service.answer(
      { sessionId: ASSISTANT_SESSION, ownerId: ASSISTANT_CLIENT_ID },
      { op: "overview" },
    );

    expect(result).toMatchObject({
      op: "overview",
      overview: {
        projects: [{ id: BLOG, name: "Blog" }],
        active: [{ id: DISPATCHED, state: "running", dispatched: true }],
        dispatched: [{ id: DISPATCHED, title: "修首页" }],
        pendingApprovals: 0,
      },
    });
  });
});
