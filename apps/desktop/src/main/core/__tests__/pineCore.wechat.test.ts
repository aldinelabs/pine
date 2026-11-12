// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PineAgentEvent } from "../../../shared/agent";
import { WECHAT_CLIENT_ID } from "../../../shared/wechatRemote";
import { PineCore } from "../pineCore";

const answerSessionOperation = vi.hoisted(() => vi.fn());
vi.mock("../requests/sessions", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  answerSessionOperation,
}));
const unlinkSession = vi.hoisted(() => vi.fn());
vi.mock("../subSessions", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  unlinkSession,
}));

const sessionId = "11111111-1111-4111-8111-111111111111";
const childId = "33333333-3333-4333-8333-333333333333";
const fromProjectId = "22222222-2222-4222-8222-222222222222";
const projectId = "44444444-4444-4444-8444-444444444444";

const targetProject = {
  id: projectId,
  name: "Target",
  defaultFolderId: "f",
  folders: [
    {
      id: "f",
      name: "target",
      path: "/work/target",
      access: "read-write",
      isAvailable: true,
    },
  ],
};

interface Internals {
  routeAgentEvent(event: PineAgentEvent): void;
  answerHostRequest(
    event: Extract<PineAgentEvent, { type: "host-request" }>,
    ownerId: number,
  ): Promise<void>;
  teleportSession(sessionId: string, projectId: string): Promise<void>;
}

/**
 * A PineCore built without its constructor: only the parts the routing and
 * WeChat hooks touch, with the bridge's methods replaced by spies.
 */
function fixture({
  owner = 7,
  projectHolders = [],
}: { owner?: number | null; projectHolders?: number[] } = {}) {
  const controller = owner ?? undefined;
  const wechat = {
    observeAgentEvent: vi.fn(),
    sessionSpawned: vi.fn(),
    sessionMoved: vi.fn(),
    automationsChanged: vi.fn(),
    originOf: vi.fn(),
    automationRunRefusal: vi.fn(),
  };
  const host = {
    observeAgentEvent: vi.fn(),
    sendToClient: vi.fn(() => true),
    libraryChanged: vi.fn(),
  };
  const runtimes = {
    sideChatOf: vi.fn(),
    controllerOfSession: vi.fn(() => controller),
    clientsOfSession: vi.fn(() =>
      controller === undefined ? [] : [controller],
    ),
    clientsOfProject: vi.fn(() => projectHolders),
    ownerOfProject: vi.fn(() => projectHolders[0]),
    takeScheduledTeleport: vi.fn(),
    clearSessionInteractions: vi.fn(),
    scheduleTeleport: vi.fn(),
    teleportSession: vi.fn(() =>
      Promise.resolve({ fromProjectId, webContentsId: 7 }),
    ),
    share: vi.fn(() => Promise.resolve()),
  };
  const agentHost = { respondHostRequest: vi.fn() };
  const web = {
    server: { publish: vi.fn() },
    publishSession: vi.fn(),
    libraryChanged: vi.fn(),
  };
  const core = Object.create(PineCore.prototype) as PineCore;
  Object.assign(core, {
    host,
    wechat,
    runtimes,
    agentHost,
    web,
    automations: {
      observeAgentEvent: vi.fn(() => false),
      projectsChanged: vi.fn(() => Promise.resolve()),
    },
    repository: {
      list: vi.fn(() => Promise.resolve([targetProject])),
      open: vi.fn(() => Promise.resolve(targetProject)),
      dataPaths: vi.fn(() => ({})),
    },
    presentedFiles: { remember: vi.fn() },
    providerLoginOwners: new Map(),
    runningSessions: new Set(),
    sessionsWithRunningTasks: new Set(),
    afterReply: new Map(),
  });
  return {
    core,
    internals: core as unknown as Internals,
    wechat,
    host,
    runtimes,
    agentHost,
    web,
  };
}

const runState: PineAgentEvent = {
  type: "run-state",
  sessionId,
  state: "running",
};

beforeEach(() => {
  answerSessionOperation.mockReset();
  unlinkSession.mockReset();
  unlinkSession.mockResolvedValue(undefined);
});

describe("PineCore and WeChat remote", () => {
  it("shows the bridge every routed event with its owner", () => {
    const { internals, wechat, host } = fixture();
    internals.routeAgentEvent(runState);
    expect(wechat.observeAgentEvent).toHaveBeenCalledWith(runState, 7);
    expect(host.sendToClient).toHaveBeenCalled();
  });

  it("shows the bridge events of sessions no interface holds", () => {
    const { internals, wechat, host } = fixture({ owner: null });
    internals.routeAgentEvent(runState);
    expect(wechat.observeAgentEvent).toHaveBeenCalledWith(runState, undefined);
    expect(host.sendToClient).not.toHaveBeenCalled();
  });

  it("keeps routing when the bridge throws", () => {
    const { internals, wechat, host, web } = fixture();
    wechat.observeAgentEvent.mockImplementation(() => {
      throw new Error("bridge broke");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => internals.routeAgentEvent(runState)).not.toThrow();
    expect(host.sendToClient).toHaveBeenCalled();
    expect(web.publishSession).toHaveBeenCalledWith(runState);
    error.mockRestore();
  });

  it("tells the bridge about a session the agent started", async () => {
    const { internals, wechat, agentHost } = fixture();
    answerSessionOperation.mockResolvedValue({
      op: "start",
      sessionId: childId,
      projectId,
      projectName: "Target",
      approvalMode: "auto-approve",
      parentSessionId: sessionId,
    });
    await internals.answerHostRequest(
      {
        type: "host-request",
        sessionId,
        requestId: "r1",
        request: { kind: "session", operation: { op: "start" } as never },
      },
      7,
    );
    expect(wechat.sessionSpawned).toHaveBeenCalledWith(
      sessionId,
      childId,
      projectId,
    );
    expect(agentHost.respondHostRequest).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ ok: true }),
    );
  });

  it("does not report other session operations as spawned", async () => {
    const { internals, wechat } = fixture();
    answerSessionOperation.mockResolvedValue({ op: "search", sessions: [] });
    await internals.answerHostRequest(
      {
        type: "host-request",
        sessionId,
        requestId: "r1",
        request: { kind: "session", operation: { op: "search" } as never },
      },
      7,
    );
    expect(wechat.sessionSpawned).not.toHaveBeenCalled();
  });

  it("tells the bridge when a session moved", async () => {
    const { internals, wechat, runtimes } = fixture();
    await internals.teleportSession(sessionId, projectId);
    expect(runtimes.teleportSession).toHaveBeenCalled();
    expect(wechat.sessionMoved).toHaveBeenCalledWith(
      sessionId,
      fromProjectId,
      projectId,
    );
  });

  it("does not report a move that failed", async () => {
    const { internals, wechat, runtimes } = fixture();
    runtimes.teleportSession.mockRejectedValue(new Error("no"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await internals.teleportSession(sessionId, projectId);
    expect(wechat.sessionMoved).not.toHaveBeenCalled();
    error.mockRestore();
  });

  const teleport = {
    type: "host-request" as const,
    sessionId,
    requestId: "r2",
    request: { kind: "teleport" as const, projectId },
  };

  it("moves a session into a project only WeChat holds", async () => {
    const { internals, runtimes, agentHost } = fixture({
      projectHolders: [WECHAT_CLIENT_ID],
    });
    await internals.answerHostRequest(teleport, 7);
    expect(runtimes.scheduleTeleport).toHaveBeenCalledWith(
      sessionId,
      projectId,
    );
    expect(agentHost.respondHostRequest).toHaveBeenCalledWith(
      "r2",
      expect.objectContaining({ ok: true }),
    );
  });

  it("still refuses a move into a project another window holds", async () => {
    const { internals, runtimes, agentHost } = fixture({
      projectHolders: [WECHAT_CLIENT_ID, 9],
    });
    await internals.answerHostRequest(teleport, 7);
    expect(runtimes.scheduleTeleport).not.toHaveBeenCalled();
    expect(agentHost.respondHostRequest).toHaveBeenCalledWith("r2", {
      ok: false,
      error: "That project is open in another Pine window.",
    });
  });

  it("sends nothing to WeChat's client id", () => {
    const { core, host, web } = fixture();
    core.sendClientEvent(WECHAT_CLIENT_ID, "any", {});
    expect(host.sendToClient).not.toHaveBeenCalled();
    expect(web.server.publish).not.toHaveBeenCalled();
    core.sendClientEvent(7, "any", {});
    expect(host.sendToClient).toHaveBeenCalledWith(7, "any", {});
  });
});
