import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { AgentWorkerRequest } from "../../agent/protocol";
import type { PineAgentEvent } from "../../shared/agent";
import { AgentProcessHost } from "../agentProcessHost";

vi.mock("electron", () => ({
  utilityProcess: { fork: vi.fn() },
}));

class FakeAgentProcess extends EventEmitter {
  readonly stdout = { resume: vi.fn() };
  readonly stderr = { resume: vi.fn() };
  readonly requests: AgentWorkerRequest[] = [];
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }

  postMessage(message: AgentWorkerRequest): void {
    this.requests.push(message);
  }
}

function createHost() {
  const process = new FakeAgentProcess();
  const host = new AgentProcessHost(() => {
    queueMicrotask(() => process.emit("message", { type: "ready" }));
    return process;
  });
  return { host, process };
}

describe("AgentProcessHost", () => {
  it("drains agent output so full pipes cannot block requests", async () => {
    const { host, process } = createHost();
    const pending = host.abort("session-1");
    await vi.waitFor(() => expect(process.requests).toHaveLength(1));
    expect(process.stdout.resume).toHaveBeenCalledOnce();
    expect(process.stderr.resume).toHaveBeenCalledOnce();
    process.emit("exit", 9);
    await expect(pending).rejects.toThrow("exited unexpectedly");
  });

  it("correlates typed requests and responses", async () => {
    const { host, process } = createHost();
    const location = {
      agentDir: "/pine/agent",
      cwd: "/project",
      folders: [{ access: "read-write" as const, path: "/project" }],
      sessionsRoot: "/pine/sessions",
    };
    const pending = host.createSession(location);
    await vi.waitFor(() => expect(process.requests).toHaveLength(1));
    const request = process.requests[0];

    process.emit("message", {
      type: "response",
      id: request.id,
      ok: true,
      result: {
        session: {
          id: "session-1",
          createdAt: "2026-08-24T12:00:00.000Z",
          updatedAt: "2026-08-24T12:00:00.000Z",
          messageCount: 0,
        },
      },
    });

    await expect(pending).resolves.toEqual(
      expect.objectContaining({
        session: expect.objectContaining({ id: "session-1" }),
      }),
    );
    expect(request).toEqual(
      expect.objectContaining({ type: "session:create", location }),
    );
  });

  it("forwards worker events to subscribers", async () => {
    const { host, process } = createHost();
    const listener = vi.fn();
    host.subscribe(listener);
    const event: PineAgentEvent = {
      type: "run-state",
      sessionId: "session-1",
      state: "running",
    };

    const pending = host.abort("session-1");
    await vi.waitFor(() => expect(process.requests).toHaveLength(1));
    process.emit("message", { type: "event", event });
    expect(listener).toHaveBeenCalledWith(event);

    process.emit("message", {
      type: "response",
      id: process.requests[0].id,
      ok: true,
      result: { aborted: true },
    });
    await pending;
  });

  it("sends typed session rename requests", async () => {
    const { host, process } = createHost();
    const pending = host.renameSession("session-1", "Renamed session");
    await vi.waitFor(() => expect(process.requests).toHaveLength(1));

    expect(process.requests[0]).toEqual(
      expect.objectContaining({
        type: "session:rename",
        sessionId: "session-1",
        name: "Renamed session",
      }),
    );
    process.emit("message", {
      type: "response",
      id: process.requests[0].id,
      ok: true,
      result: {
        session: {
          id: "session-1",
          createdAt: "2026-08-24T12:00:00.000Z",
          updatedAt: "2026-08-24T12:01:00.000Z",
          messageCount: 0,
          name: "Renamed session",
        },
      },
    });

    await expect(pending).resolves.toEqual(
      expect.objectContaining({
        session: expect.objectContaining({ name: "Renamed session" }),
      }),
    );
  });

  it("sends typed steering dequeue requests", async () => {
    const { host, process } = createHost();
    const pending = host.dequeueSteering("session-1", "Change direction");
    await vi.waitFor(() => expect(process.requests).toHaveLength(1));

    expect(process.requests[0]).toEqual(
      expect.objectContaining({
        type: "session:dequeue-steering",
        sessionId: "session-1",
        message: "Change direction",
      }),
    );
    process.emit("message", {
      type: "response",
      id: process.requests[0].id,
      ok: true,
      result: { message: "Change direction", removed: true },
    });

    await expect(pending).resolves.toEqual({
      message: "Change direction",
      removed: true,
    });
  });

  it("sends typed manual compaction requests", async () => {
    const { host, process } = createHost();
    const pending = host.compact("session-1");
    await vi.waitFor(() => expect(process.requests).toHaveLength(1));

    expect(process.requests[0]).toEqual(
      expect.objectContaining({
        type: "session:compact",
        sessionId: "session-1",
      }),
    );
    process.emit("message", {
      type: "response",
      id: process.requests[0].id,
      ok: true,
      result: { compacted: true },
    });

    await expect(pending).resolves.toEqual({ compacted: true });
  });

  it("sends the dedicated utility model selection to the worker", async () => {
    const { host, process } = createHost();
    const selection = { providerId: "provider", modelId: "utility-model" };
    const pending = host.selectUtilityModel("/pine/agent", selection);
    await vi.waitFor(() => expect(process.requests).toHaveLength(1));

    expect(process.requests[0]).toEqual(
      expect.objectContaining({
        type: "models:select-utility",
        agentDir: "/pine/agent",
        selection,
      }),
    );
    process.emit("message", {
      type: "response",
      id: process.requests[0].id,
      ok: true,
      result: { updated: true },
    });

    await expect(pending).resolves.toEqual({ updated: true });
  });

  it("rejects pending work when the utility process exits", async () => {
    const { host, process } = createHost();
    const pending = host.abort("session-1");
    await vi.waitFor(() => expect(process.requests).toHaveLength(1));

    process.emit("exit", 9);

    await expect(pending).rejects.toThrow(
      "The Pine agent process exited unexpectedly (9).",
    );
  });

  it("rejects work when the utility process exits before becoming ready", async () => {
    const process = new FakeAgentProcess();
    const host = new AgentProcessHost(() => {
      queueMicrotask(() => process.emit("exit", 7));
      return process;
    });

    await expect(host.getModelCatalog("/pine/agent")).rejects.toThrow(
      "The Pine agent process exited unexpectedly (7).",
    );
  });
});
