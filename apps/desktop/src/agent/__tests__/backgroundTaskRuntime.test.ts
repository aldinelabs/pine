// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { BackgroundTaskRegistry } from "@pine/pi-background-tasks/registry";
import { expect, it, vi } from "vitest";
import { PineAgentRuntime } from "../runtime";

it("delivers background completions through the live session and kills tasks on close", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pine-bg-runtime-"));
  const location = {
    agentDir: path.join(root, "agent"),
    cwd: root,
    folders: [{ access: "read-write" as const, path: root }],
    sessionsRoot: path.join(root, "sessions"),
  };
  await mkdir(location.agentDir);
  await writeFile(
    path.join(location.agentDir, "models.json"),
    JSON.stringify({
      providers: {
        verify: {
          api: "openai-completions",
          apiKey: "verify-key",
          baseUrl: "http://127.0.0.1:1/v1",
          models: [
            {
              id: "offline",
              name: "Offline verification",
              contextWindow: 200_000,
              maxTokens: 8192,
              input: ["text"],
            },
          ],
        },
      },
    }),
  );
  await writeFile(
    path.join(location.agentDir, "settings.json"),
    JSON.stringify({ defaultProvider: "verify", defaultModel: "offline" }),
  );
  const emit = vi.fn();
  const runtime = new PineAgentRuntime({ emit });
  try {
    const created = await runtime.createSession(location);
    const internals = runtime as unknown as {
      liveSessions: Map<
        string,
        { session: AgentSession; backgroundTasks: BackgroundTaskRegistry }
      >;
    };
    const live = internals.liveSessions.get(created.session.id)!;
    expect(live.session.getActiveToolNames()).toEqual(
      expect.arrayContaining(["bg_run", "bg_status", "bg_logs", "bg_kill"]),
    );
    const send = vi
      .spyOn(live.session, "sendCustomMessage")
      .mockResolvedValue(undefined);
    const finished = await live.backgroundTasks.start("printf hello", {
      name: "Quick",
      privileged: true,
      triggerOnCompletion: true,
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        customType: "background-task-notification",
        content: expect.stringContaining("<status>completed</status>"),
      }),
      { deliverAs: "followUp", triggerTurn: true },
    );
    expect(
      runtime.listBackgroundTasks(created.session.id).tasks[0],
    ).toMatchObject({ id: finished.id, status: "completed", exitCode: 0 });
    expect(emit.mock.calls.map(([event]) => event)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "run-state", state: "running" }),
        expect.objectContaining({ type: "run-state", state: "idle" }),
      ]),
    );
    const read = await runtime.readBackgroundTaskOutput(
      created.session.id,
      finished.id,
      100,
    );
    expect(read.content).toBe("hello");
    const rerun = await runtime.rerunBackgroundTask(
      created.session.id,
      finished.id,
    );
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]?.[1]).toEqual({
      deliverAs: "followUp",
      triggerTurn: false,
    });
    expect(rerun.task.id).not.toBe(finished.id);
    const long = await live.backgroundTasks.start("sleep 60", {
      privileged: true,
    });
    await runtime.disposeSession(created.session.id);
    expect(live.backgroundTasks.snapshot(long.id).status).toBe("killed");
    expect(send).toHaveBeenCalledTimes(2);
  } finally {
    await runtime.dispose();
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
