// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PineAgentEvent } from "../../../shared/agent";
import { PineCore } from "../pineCore";

const notifyParentOf = vi.hoisted(() => vi.fn());
vi.mock("../subSessions", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  notifyParentOf,
}));

const sessionId = "33333333-3333-4333-8333-333333333333";

interface Internals {
  routeAgentEvent(event: PineAgentEvent): void;
}

/** A PineCore built without its constructor: only what routing a run touches. */
function fixture() {
  const assistant = {
    report: vi.fn(() => Promise.resolve()),
  };
  const core = Object.create(PineCore.prototype) as PineCore;
  Object.assign(core, {
    host: {
      observeAgentEvent: vi.fn(),
      sendToClient: vi.fn(() => true),
      libraryChanged: vi.fn(),
    },
    wechat: { observeAgentEvent: vi.fn() },
    runtimes: {
      sideChatOf: vi.fn(),
      controllerOfSession: vi.fn(() => 7),
      clientsOfSession: vi.fn(() => [7]),
      clientsOfProject: vi.fn(() => []),
      takeScheduledTeleport: vi.fn(),
      clearSessionInteractions: vi.fn(),
    },
    automations: { observeAgentEvent: vi.fn(() => false) },
    assistant,
    web: {
      server: { publish: vi.fn() },
      publishSession: vi.fn(),
      libraryChanged: vi.fn(),
    },
    sessionListChanges: { notify: vi.fn(), flush: vi.fn(() => true) },
    runningSessions: new Set(),
    sessionsWithRunningTasks: new Set(),
    afterReply: new Map(),
    agentStops: new Map(),
    abortsInFlight: new Map(),
  });
  return { core, assistant, internals: core as unknown as Internals };
}

function runState(state: "running" | "aborting" | "idle" | "failed") {
  return { type: "run-state", sessionId, state } as PineAgentEvent;
}

beforeEach(() => {
  notifyParentOf.mockReset();
  notifyParentOf.mockResolvedValue(undefined);
});

describe("a sub-session's stopped turn", () => {
  it("reports a turn that ends on its own as finished", () => {
    const { core, internals } = fixture();

    internals.routeAgentEvent(runState("running"));
    internals.routeAgentEvent(runState("idle"));

    expect(notifyParentOf).toHaveBeenCalledExactlyOnceWith(
      core,
      sessionId,
      "finished",
    );
  });

  it("reports the same end of the turn to the Assistant", () => {
    const { assistant, internals } = fixture();

    internals.routeAgentEvent(runState("running"));
    internals.routeAgentEvent(runState("idle"));

    expect(assistant.report).toHaveBeenCalledExactlyOnceWith(
      sessionId,
      "finished",
    );
  });

  it("reports the user's Stop as stopped, once", () => {
    const { core, internals } = fixture();

    internals.routeAgentEvent(runState("aborting"));
    internals.routeAgentEvent(runState("idle"));
    internals.routeAgentEvent(runState("idle"));

    expect(notifyParentOf.mock.calls).toEqual([
      [core, sessionId, "stopped"],
      [core, sessionId, "finished"],
    ]);
  });

  it("tells the parent nothing about a stop it made itself", async () => {
    const { core, internals } = fixture();

    await core.stopForSession(sessionId, "parent", () => {
      internals.routeAgentEvent(runState("aborting"));
      internals.routeAgentEvent(runState("idle"));
      return Promise.resolve({ aborted: true });
    });

    expect(notifyParentOf).not.toHaveBeenCalled();
  });

  it("reports another session's stop as an ordinary end of the turn", async () => {
    const { core, internals } = fixture();

    await core.stopForSession(sessionId, "session", () => {
      internals.routeAgentEvent(runState("aborting"));
      return Promise.resolve({ aborted: true });
    });
    internals.routeAgentEvent(runState("idle"));

    expect(notifyParentOf).toHaveBeenCalledExactlyOnceWith(
      core,
      sessionId,
      "finished",
    );
  });

  it("counts a Stop after the parent's stop call returned as the user's", async () => {
    const { core, internals } = fixture();

    await core.stopForSession(sessionId, "parent", () =>
      Promise.resolve({ aborted: false }),
    );
    internals.routeAgentEvent(runState("aborting"));
    internals.routeAgentEvent(runState("idle"));

    expect(notifyParentOf).toHaveBeenCalledExactlyOnceWith(
      core,
      sessionId,
      "stopped",
    );
  });
});
