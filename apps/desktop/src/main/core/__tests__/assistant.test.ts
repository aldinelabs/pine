// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSISTANT_CLIENT_ID,
  ASSISTANT_PROJECT_ID,
  assistantAttachmentId,
} from "../../../shared/assistant";
import {
  parseAttachmentMessage,
  serializeAttachmentMessage,
  type PineAttachment,
} from "../../../shared/attachments";
import {
  markWeChatMessage,
  readAssistantMessage,
} from "../../../agent/assistant/prompt";
import type { PineProject } from "../../../shared/projects";
import type { PineTextMessage } from "../../../shared/sessions";
import { AssistantService } from "../assistant";
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

function userMessage(text: string): PineTextMessage {
  return {
    id: "u",
    role: "user",
    createdAt: "2026-11-24T00:00:00.000Z",
    blocks: [{ type: "text", text }],
  } as unknown as PineTextMessage;
}

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
    summaryOfLiveSession: vi.fn((id: string) => ({ id, name: "修首页" })),
    loadMessages: vi.fn(() =>
      Promise.resolve({ hasMore: false, messages: [reply("首页已修好。")] }),
    ),
    resume: vi.fn(() => Promise.resolve()),
    prompt: vi.fn(() =>
      Promise.resolve({ accepted: true, session: { id: ASSISTANT_SESSION } }),
    ),
    setApprovalMode: vi.fn(() => Promise.resolve({ updated: true })),
    selectModel: vi.fn(() => Promise.resolve({ disposed: false })),
    getModelCatalog: vi.fn(() =>
      Promise.resolve({
        models: [],
        providers: [],
        selection: {
          providerId: "p",
          modelId: "default",
          thinkingLevel: "low",
        },
      }),
    ),
    deleteSession: vi.fn(() => Promise.resolve(true)),
    contextUsageOf: vi.fn<(id: string) => { cost: number } | undefined>(
      () => undefined,
    ),
    hasPendingApproval: vi.fn(() => true),
  };
  const automations = {
    list: vi.fn(() => Promise.resolve([] as unknown[])),
    get: vi.fn(),
    setEnabled: vi.fn(() => Promise.resolve()),
    runNow: vi.fn(),
    pendingApprovals: vi.fn(() => [] as unknown[]),
  };
  const wechat = {
    status: vi.fn(() => ({
      bound: false,
      paused: false,
      settings: { allowHighRiskApprovals: false },
    })),
    cardNumberOf: vi.fn((): number | undefined => undefined),
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
      dataPaths: vi.fn((id: string) => ({
        projectRoot: root,
        attachmentsRoot: path.join(root, "attachments", id),
      })),
    },
    runtimes,
    agentHost,
    automations,
    wechat,
    sessionActivity: vi.fn(() => "running"),
    displayCurrency: vi.fn(() => ({ currency: "USD", rate: 1 })),
    notifyLibraryChanged: vi.fn(),
    notifySessionsDeleted: vi.fn(),
  } as unknown as PineCore;
  return {
    root,
    core,
    runtimes,
    agentHost,
    automations,
    wechat,
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

  it("hands the attachments it names on: its own files copied, the user's by reference", async () => {
    const { root, runtimes, service } = await fixture();
    const ownRoot = path.join(root, "attachments", ASSISTANT_PROJECT_ID);
    await mkdir(ownRoot, { recursive: true });
    const pasted: PineAttachment = {
      name: "截图.png",
      path: path.join(ownRoot, "pasted.png"),
      extension: "png",
      kind: "file",
      size: 3,
      modifiedAt: "2026-11-20T00:00:00.000Z",
    };
    await writeFile(pasted.path, "png");
    const picked: PineAttachment = {
      name: "q3.csv",
      path: "/Users/me/finance/q3.csv",
      extension: "csv",
      kind: "file",
      size: 4096,
      modifiedAt: "2026-11-20T00:00:00.000Z",
    };
    runtimes.loadMessages.mockResolvedValueOnce({
      hasMore: false,
      messages: [],
      outline: [
        userMessage(serializeAttachmentMessage([pasted, picked], "看看这些")),
      ],
    } as never);

    const result = await service.answer(
      { sessionId: ASSISTANT_SESSION, ownerId: ASSISTANT_CLIENT_ID },
      {
        ...dispatch,
        attachmentIds: [
          assistantAttachmentId(picked),
          assistantAttachmentId(pasted),
        ],
      },
    );

    expect(result).toMatchObject({ op: "dispatch", attachments: 2 });
    expect(runtimes.loadMessages).toHaveBeenCalledWith(
      ASSISTANT_CLIENT_ID,
      ASSISTANT_PROJECT_ID,
      ASSISTANT_SESSION,
      undefined,
      1,
      true,
    );
    const [, input] = startBackgroundSession.mock.calls[0] as [
      unknown,
      { message: string },
    ];
    const { attachments, prompt } = parseAttachmentMessage(input.message);
    expect(prompt).toMatch(/^\[Dispatched by Pine's Assistant\./);
    expect(prompt).toContain("修一下首页样式");
    expect(attachments[0]).toEqual(picked);
    const copy = attachments[1];
    expect(copy?.name).toBe("截图.png");
    expect(path.dirname(copy?.path ?? "")).toBe(
      path.join(root, "attachments", BLOG),
    );
    expect(await readFile(copy?.path ?? "", "utf8")).toBe("png");
  });

  it("refuses an attachment id the user never sent, before starting anything", async () => {
    const { runtimes, service } = await fixture();
    runtimes.loadMessages.mockResolvedValueOnce({
      hasMore: false,
      messages: [],
      outline: [userMessage("没有附件")],
    } as never);

    await expect(
      service.answer(
        { sessionId: ASSISTANT_SESSION, ownerId: ASSISTANT_CLIENT_ID },
        { ...dispatch, attachmentIds: ["att_0000000000000000"] },
      ),
    ).rejects.toThrow(
      /No attachment att_0000000000000000 in this conversation/,
    );
    expect(startBackgroundSession).not.toHaveBeenCalled();
  });

  it("counts its dispatched sessions' work for the tray", async () => {
    const { core, service } = await fixture();
    expect(service.trayStatus()).toEqual({ running: 0, awaitingApproval: 0 });

    await service.answer(
      { sessionId: ASSISTANT_SESSION, ownerId: ASSISTANT_CLIENT_ID },
      dispatch,
    );
    expect(service.trayStatus()).toEqual({ running: 1, awaitingApproval: 0 });
    (
      core as unknown as { sessionActivity: ReturnType<typeof vi.fn> }
    ).sessionActivity.mockReturnValue("awaiting-approval");
    expect(service.trayStatus()).toEqual({ running: 0, awaitingApproval: 1 });
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
      { triggerTurn: false },
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

describe("the Assistant's desktop conversation", () => {
  it("starts its one conversation like any session, in the composer's mode", async () => {
    const { root, service, runtimes } = await fixture();

    await service.prompt(9, {
      locale: "zh-CN",
      message: "看看在跑什么",
      approvalMode: "let-me-review",
    });

    expect(runtimes.prompt).toHaveBeenCalledWith(
      9,
      expect.objectContaining({
        target: { kind: "new", projectId: ASSISTANT_PROJECT_ID },
        approvalMode: "let-me-review",
      }),
      {},
    );
    const state = JSON.parse(
      await readFile(path.join(root, "state.json"), "utf8"),
    ) as { sessionId: string };
    expect(state.sessionId).toBe(ASSISTANT_SESSION);
  });

  it("sends later messages to the same conversation", async () => {
    const { service, runtimes } = await fixture();
    await service.prompt(9, { locale: "zh-CN", message: "第一条" });
    listProjectSessions.mockResolvedValue([{ id: ASSISTANT_SESSION }]);

    await service.prompt(9, { locale: "zh-CN", message: "第二条" });

    expect(runtimes.prompt).toHaveBeenLastCalledWith(
      9,
      expect.objectContaining({
        target: {
          kind: "session",
          projectId: ASSISTANT_PROJECT_ID,
          sessionId: ASSISTANT_SESSION,
        },
        approvalMode: "auto-approve",
      }),
      {},
    );
  });

  it("never runs in YOLO", async () => {
    const { service, runtimes } = await fixture();

    await service.prompt(9, {
      locale: "zh-CN",
      message: "你好",
      approvalMode: "YOLO",
    });

    expect(runtimes.prompt).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ approvalMode: "autonomous" }),
      {},
    );
  });

  it("lets a report wait for the user instead of starting a turn", async () => {
    const { service, agentHost } = await fixture();
    await service.answer(
      { sessionId: ASSISTANT_SESSION, ownerId: ASSISTANT_CLIENT_ID },
      dispatch,
    );

    await service.report(DISPATCHED, "finished");

    expect(agentHost.notifySession).toHaveBeenCalledWith(
      ASSISTANT_SESSION,
      expect.anything(),
      expect.any(String),
      { triggerTurn: false },
    );
  });

  it("ends its conversation when that session is deleted, and reports to it no more", async () => {
    const { service, agentHost } = await fixture();
    await service.prompt(9, { locale: "zh-CN", message: "你好" });
    listProjectSessions.mockResolvedValue([{ id: ASSISTANT_SESSION }]);
    await service.answer(
      { sessionId: ASSISTANT_SESSION, ownerId: ASSISTANT_CLIENT_ID },
      dispatch,
    );

    // Deleted like any session.
    await service.sessionsDeleted([ASSISTANT_SESSION]);
    listProjectSessions.mockResolvedValue([]);

    await expect(service.describeState()).resolves.not.toHaveProperty(
      "session",
    );
    await service.report(DISPATCHED, "finished");
    expect(agentHost.notifySession).not.toHaveBeenCalled();
    // What it dispatched stays marked as its own.
    await expect(service.dispatchedIds()).resolves.toContain(DISPATCHED);
  });
});

describe("the Assistant from WeChat", () => {
  it("starts its one conversation as its own client and remembers it", async () => {
    const { root, runtimes, service } = await fixture();

    const sent = await service.send("帮我修一下博客首页", {
      locale: "zh-CN",
      source: "wechat",
      ceiling: "let-me-review",
    });

    expect(sent).toEqual({
      sessionId: ASSISTANT_SESSION,
      projectId: ASSISTANT_PROJECT_ID,
    });
    expect(runtimes.prompt).toHaveBeenCalledWith(
      ASSISTANT_CLIENT_ID,
      expect.objectContaining({
        // Marked as typed in WeChat, for the prompt's WeChat style.
        message: "[WeChat]\n帮我修一下博客首页",
        target: { kind: "new", projectId: ASSISTANT_PROJECT_ID },
        approvalMode: "auto-approve",
      }),
      { focus: false },
    );
    expect(
      JSON.parse(await readFile(path.join(root, "state.json"), "utf8")),
    ).toEqual({ version: 1, sessionId: ASSISTANT_SESSION });
  });

  it("steers its running turn with the next message", async () => {
    const { runtimes, service } = await fixture();
    await service.send("第一条", { locale: "zh-CN", source: "wechat" });
    runtimes.liveSessionIdsOf.mockImplementation((projectId: string) =>
      projectId === ASSISTANT_PROJECT_ID ? [ASSISTANT_SESSION] : [DISPATCHED],
    );

    await service.send("再加一句", {
      locale: "zh-CN",
      source: "wechat",
      steer: true,
    });

    expect(runtimes.prompt).toHaveBeenLastCalledWith(
      ASSISTANT_CLIENT_ID,
      expect.objectContaining({
        target: {
          kind: "session",
          projectId: ASSISTANT_PROJECT_ID,
          sessionId: ASSISTANT_SESSION,
        },
        message: markWeChatMessage("再加一句"),
        streamingBehavior: "steer",
      }),
      { focus: false },
    );
  });

  it("marks only what came from WeChat", async () => {
    const { runtimes, service } = await fixture();
    const lastMessage = (message: string) =>
      expect(runtimes.prompt).toHaveBeenLastCalledWith(
        ASSISTANT_CLIENT_ID,
        expect.objectContaining({ message }),
        { focus: false },
      );
    await service.send("看看现在在跑啥", {
      locale: "zh-CN",
      source: "desktop",
    });
    lastMessage("看看现在在跑啥");
    await service.send("看看现在在跑啥", { locale: "zh-CN", source: "wechat" });
    const marked = markWeChatMessage("看看现在在跑啥");
    lastMessage(marked);
    expect(readAssistantMessage(marked)).toEqual({
      text: "看看现在在跑啥",
      fromWeChat: true,
    });
  });

  it("dispatches a WeChat turn's work within the WeChat ceiling and reports it", async () => {
    const { service } = await fixture();
    const dispatched = vi.fn();
    service.onDispatched = dispatched;
    await service.send("修首页", {
      locale: "zh-CN",
      source: "wechat",
      ceiling: "let-me-review",
    });

    const result = await service.answer(
      { sessionId: ASSISTANT_SESSION, ownerId: ASSISTANT_CLIENT_ID },
      dispatch,
    );

    expect(result).toMatchObject({ approvalMode: "let-me-review" });
    expect(startBackgroundSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ approvalMode: "let-me-review" }),
    );
    expect(dispatched).toHaveBeenCalledWith(
      { sessionId: DISPATCHED, projectId: BLOG },
      { source: "wechat" },
    );
  });

  it("keeps a desktop turn's mode and says it came from the desktop", async () => {
    const { service } = await fixture();
    const dispatched = vi.fn();
    service.onDispatched = dispatched;
    await service.send("修首页", { locale: "zh-CN", source: "desktop" });

    const result = await service.answer(
      { sessionId: ASSISTANT_SESSION, ownerId: ASSISTANT_CLIENT_ID },
      dispatch,
    );

    expect(result).toMatchObject({ approvalMode: "auto-approve" });
    expect(dispatched).toHaveBeenCalledWith(
      { sessionId: DISPATCHED, projectId: BLOG },
      { source: "desktop" },
    );
  });
});

describe("the Assistant's one conversation, from the desktop and WeChat", () => {
  it("puts both into the same conversation, each marked with its source", async () => {
    const { runtimes, service } = await fixture();
    await service.prompt(9, { locale: "zh-CN", message: "桌面这条" });
    listProjectSessions.mockResolvedValue([{ id: ASSISTANT_SESSION }]);

    await service.send("微信这条", { locale: "zh-CN", source: "wechat" });

    expect(runtimes.prompt).toHaveBeenNthCalledWith(
      1,
      9,
      expect.objectContaining({ message: "桌面这条" }),
      {},
    );
    expect(runtimes.prompt).toHaveBeenLastCalledWith(
      ASSISTANT_CLIENT_ID,
      expect.objectContaining({
        message: markWeChatMessage("微信这条"),
        target: {
          kind: "session",
          projectId: ASSISTANT_PROJECT_ID,
          sessionId: ASSISTANT_SESSION,
        },
      }),
      { focus: false },
    );
  });

  it("runs WeChat turns in its conversation's mode, and dispatches within the ceiling below it", async () => {
    const { runtimes, service } = await fixture();
    await service.prompt(9, { locale: "zh-CN", message: "你好" });
    listProjectSessions.mockResolvedValue([{ id: ASSISTANT_SESSION }]);
    runtimes.approvalModeOfLiveSession.mockReturnValue("autonomous");

    await service.send("修首页", {
      locale: "zh-CN",
      source: "wechat",
      ceiling: "auto-approve",
    });
    expect(runtimes.prompt).toHaveBeenLastCalledWith(
      ASSISTANT_CLIENT_ID,
      expect.objectContaining({ approvalMode: "autonomous" }),
      { focus: false },
    );

    const result = await service.answer(
      { sessionId: ASSISTANT_SESSION, ownerId: ASSISTANT_CLIENT_ID },
      { ...dispatch, approvalMode: "autonomous" },
    );
    expect(result).toMatchObject({ approvalMode: "auto-approve" });
  });

  it("keeps a WeChat ceiling when the desktop writes into the running turn", async () => {
    const { service } = await fixture();
    await service.send("修首页", {
      locale: "zh-CN",
      source: "wechat",
      ceiling: "let-me-review",
    });
    listProjectSessions.mockResolvedValue([{ id: ASSISTANT_SESSION }]);
    await service.prompt(9, {
      locale: "zh-CN",
      message: "顺便看看样式",
      streamingBehavior: "steer",
    });

    const result = await service.answer(
      { sessionId: ASSISTANT_SESSION, ownerId: ASSISTANT_CLIENT_ID },
      dispatch,
    );
    expect(result).toMatchObject({ approvalMode: "let-me-review" });
  });
});

const ASSISTANT = {
  sessionId: ASSISTANT_SESSION,
  ownerId: ASSISTANT_CLIENT_ID,
};

/** The Assistant's conversation has started and Blog has a session. */
async function started() {
  const context = await fixture();
  await context.service.prompt(9, { locale: "zh-CN", message: "你好" });
  listProjectSessions.mockResolvedValue([
    { id: ASSISTANT_SESSION },
    { id: ELSEWHERE, name: "改样式" },
  ]);
  return context;
}

describe("cost reminders", () => {
  it("points out a dispatched session past the threshold once per multiple", async () => {
    const { service, agentHost, runtimes } = await fixture();
    await service.answer(ASSISTANT, dispatch);
    runtimes.contextUsageOf.mockImplementation((id: string) =>
      id === DISPATCHED ? { cost: 6 } : undefined,
    );

    await service.report(DISPATCHED, "finished");
    await service.report(DISPATCHED, "finished");
    runtimes.contextUsageOf.mockImplementation((id: string) =>
      id === DISPATCHED ? { cost: 10.5 } : undefined,
    );
    await service.report(DISPATCHED, "finished");

    const contents = agentHost.notifySession.mock.calls.map(
      (call) => (call as unknown as [string, unknown, string])[2],
    );
    expect(contents[0]).toContain(
      "<cost-reminder>This session has cost about US$6.00",
    );
    expect(contents[1]).not.toContain("<cost-reminder>");
    expect(contents[2]).toContain("US$11");
  });

  it("points out the Assistant's own cost once, past the reminder", async () => {
    const { service, agentHost, runtimes } = await fixture();
    await service.answer(ASSISTANT, dispatch);
    runtimes.contextUsageOf.mockImplementation((id: string) =>
      id === ASSISTANT_SESSION ? { cost: 4 } : { cost: 1 },
    );
    await service.report(DISPATCHED, "finished");
    runtimes.contextUsageOf.mockImplementation((id: string) =>
      id === ASSISTANT_SESSION ? { cost: 7 } : { cost: 1 },
    );
    await service.report(DISPATCHED, "finished");
    await service.report(DISPATCHED, "finished");

    const contents = agentHost.notifySession.mock.calls.map(
      (call) => (call as unknown as [string, unknown, string])[2],
    );
    expect(contents[0]).not.toContain("<cost-reminder>");
    expect(contents[1]).toContain(
      "Your own conversation with the user has cost",
    );
    expect(contents[2]).not.toContain("<cost-reminder>");
  });
});

describe("watches", () => {
  it("wakes the Assistant when a watched session finishes", async () => {
    const { service, agentHost } = await started();
    const created = await service.answer(ASSISTANT, {
      op: "watch-create",
      label: "改样式跑完告诉我",
      trigger: { kind: "session", projectId: BLOG, sessionId: ELSEWHERE },
    });
    if (created.op !== "watch-create") throw new Error(created.op);
    expect(created.watch.sessionTitle).toBe("修首页");

    await service.report(ELSEWHERE, "finished");

    expect(agentHost.notifySession).toHaveBeenCalledExactlyOnceWith(
      ASSISTANT_SESSION,
      { watchId: created.watch.id, label: "改样式跑完告诉我" },
      expect.stringContaining("<status>finished</status>"),
      { triggerTurn: true },
    );
    const listed = await service.answer(ASSISTANT, { op: "watch-list" });
    expect(listed).toEqual({ op: "watch-list", watches: [] });
  });

  it("refuses to watch a session that is not working", async () => {
    const { service, core } = await started();
    (
      core as unknown as { sessionActivity: ReturnType<typeof vi.fn> }
    ).sessionActivity.mockReturnValue("idle");
    await expect(
      service.answer(ASSISTANT, {
        op: "watch-create",
        label: "跑完告诉我",
        trigger: { kind: "session", projectId: BLOG, sessionId: ELSEWHERE },
      }),
    ).rejects.toThrow(/not working on anything now/);
  });

  it("answers a WeChat reminder in WeChat, or on the desktop when WeChat cannot take it", async () => {
    const { service, core } = await started();
    (
      core as unknown as { sessionActivity: ReturnType<typeof vi.fn> }
    ).sessionActivity.mockReturnValue("idle");
    await service.send("每天 18 点给我简报", {
      locale: "zh-CN",
      source: "wechat",
    });
    const notify = vi.fn();
    service.notify = notify;
    service.onWakeForWeChat = vi.fn(() => Promise.resolve(true));
    vi.useFakeTimers({ now: new Date("2026-11-24T09:59:00.000Z") });
    try {
      await service.answer(ASSISTANT, {
        op: "watch-create",
        label: "每日简报",
        trigger: {
          kind: "schedule",
          rrule: "FREQ=DAILY;BYHOUR=10;BYMINUTE=0",
          timezone: "UTC",
        },
      });
      vi.setSystemTime(new Date("2026-11-24T10:00:01.000Z"));
      await service.watches.tick();
      expect(service.onWakeForWeChat).toHaveBeenCalledWith(ASSISTANT_SESSION);
      await service.turnEnded(ASSISTANT_SESSION, "idle");
      expect(notify).not.toHaveBeenCalled();

      // The next day WeChat's reply budget is spent.
      service.onWakeForWeChat = vi.fn(() => Promise.resolve(false));
      vi.setSystemTime(new Date("2026-11-25T10:00:01.000Z"));
      await service.watches.tick();
      await service.turnEnded(ASSISTANT_SESSION, "idle");
      expect(notify).toHaveBeenCalledExactlyOnceWith({
        title: "Assistant",
        body: "首页已修好。",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("forgets its reminders when its conversation is deleted", async () => {
    const { service } = await started();
    await service.answer(ASSISTANT, {
      op: "watch-create",
      label: "提醒我",
      trigger: {
        kind: "at",
        at: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    await service.sessionsDeleted([ASSISTANT_SESSION]);
    await expect(service.watches.list()).resolves.toEqual([]);
  });
});

describe("approvals the Assistant can list", () => {
  it("lists cards as they come and go, never its own", async () => {
    const { service, wechat, automations } = await fixture();
    wechat.cardNumberOf.mockReturnValue(12);
    automations.pendingApprovals.mockReturnValue([
      {
        requestId: "auto-1",
        projectId: BLOG,
        projectName: "Blog",
        kind: "enable",
        automationId: "a-1",
        facts: { name: "日报" },
        warnings: [],
        createdAt: "2026-11-24T00:00:00.000Z",
      },
    ]);
    const request = (sessionId: string, requestId: string) =>
      ({
        type: "approval-request",
        sessionId,
        requestId,
        toolCallId: "c",
        toolName: "bash",
        trigger: "destructive-pattern",
        input: { subject: "rm -rf build" },
      }) as const;
    service.observe(request(ELSEWHERE, "r-1"));
    service.observe(request(ASSISTANT_SESSION, "r-own"));

    const listed = await service.answer(ASSISTANT, { op: "approvals" });
    expect(listed).toEqual({
      op: "approvals",
      approvals: [
        expect.objectContaining({
          kind: "approval",
          projectName: "Blog",
          sessionId: ELSEWHERE,
          what: "bash",
          subject: "rm -rf build",
          wechatCard: 12,
          localOnly: true,
        }),
        expect.objectContaining({ kind: "automation", localOnly: true }),
      ],
    });

    service.observe({
      type: "approval-decided",
      sessionId: ELSEWHERE,
      requestId: "r-1",
      toolCallId: "c",
      verdict: "approved",
      decidedBy: "user",
    });
    automations.pendingApprovals.mockReturnValue([]);
    await expect(
      service.answer(ASSISTANT, { op: "approvals" }),
    ).resolves.toEqual({ op: "approvals", approvals: [] });
  });
});

describe("automations from the Assistant", () => {
  const daily = {
    id: "a-1",
    projectId: BLOG,
    projectName: "Blog",
    name: "日报",
    revision: 1,
    status: "active",
    triggers: ["schedule"],
    running: false,
  };

  it("runs one only within WeChat's two conditions", async () => {
    const { service, automations, runtimes } = await fixture();
    automations.list.mockResolvedValue([daily]);
    const run = {
      op: "automation-run" as const,
      projectId: BLOG,
      automationId: "a-1",
    };

    // Auto Approve is below Autonomous Work, which automations run as.
    await expect(service.answer(ASSISTANT, run)).rejects.toThrow(
      /Autonomous Work/,
    );
    runtimes.approvalModeOfLiveSession.mockReturnValue("autonomous");
    automations.list.mockResolvedValue([{ ...daily, status: "off" }]);
    await expect(service.answer(ASSISTANT, run)).rejects.toThrow(/not on/);
    automations.list.mockResolvedValue([daily]);
    await expect(service.answer(ASSISTANT, run)).resolves.toEqual({
      op: "automation-run",
      name: "日报",
    });
    expect(automations.runNow).toHaveBeenCalledExactlyOnceWith(BLOG, "a-1");
  });

  it("holds a WeChat turn to WeChat's ceiling", async () => {
    const { service, automations, runtimes } = await fixture();
    runtimes.approvalModeOfLiveSession.mockReturnValue("autonomous");
    automations.list.mockResolvedValue([daily]);
    await service.send("跑一下日报", {
      locale: "zh-CN",
      source: "wechat",
      ceiling: "auto-approve",
    });
    await expect(
      service.answer(ASSISTANT, {
        op: "automation-run",
        projectId: BLOG,
        automationId: "a-1",
      }),
    ).rejects.toThrow(/auto-approve/);
    expect(automations.runNow).not.toHaveBeenCalled();
  });

  it("turns one off, never on", async () => {
    const { service, automations } = await fixture();
    automations.list.mockResolvedValue([daily]);
    await expect(
      service.answer(ASSISTANT, {
        op: "automation-disable",
        projectId: BLOG,
        automationId: "a-1",
      }),
    ).resolves.toEqual({
      op: "automation-disable",
      name: "日报",
      changed: true,
    });
    expect(automations.setEnabled).toHaveBeenCalledExactlyOnceWith(
      { projectId: BLOG, source: "web" },
      "a-1",
      false,
    );
  });
});

describe("sessions the Assistant may act on", () => {
  it("needs the user's confirmation for one it did not dispatch", async () => {
    const { service } = await started();
    await expect(
      service.answer(ASSISTANT, {
        op: "session-rename",
        projectId: BLOG,
        sessionId: ELSEWHERE,
        title: "新标题",
        confirmed: false,
      }),
    ).rejects.toThrow(/has to confirm/);
  });

  it("reads settings it cannot change", async () => {
    const { service } = await fixture();
    const result = await service.answer(ASSISTANT, { op: "settings" });
    if (result.op !== "settings") throw new Error(result.op);
    expect(result.settings).toContainEqual({
      where:
        "Your own permission mode (your conversation's permission mode menu; the most a dispatched session may use)",
      value: "auto-approve",
    });
    expect(
      result.settings.some((fact) =>
        fact.where.includes("Settings › Assistant"),
      ),
    ).toBe(false);
  });
});
