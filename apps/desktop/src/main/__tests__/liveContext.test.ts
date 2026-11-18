import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LiveContextEvent } from "../../shared/liveContext";
import {
  deleteLiveTranscript,
  LiveContextService,
  liveTranscriptPath,
  type LiveContextHelperProcess,
} from "../liveContext";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";

class FakeHelper extends EventEmitter implements LiveContextHelperProcess {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  commands: Record<string, unknown>[] = [];
  killed = false;

  constructor() {
    super();
    let buffered = "";
    this.stdin.on("data", (chunk: Buffer) => {
      buffered += chunk.toString();
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines)
        this.commands.push(JSON.parse(line) as Record<string, unknown>);
    });
    // Like the real helper: closing stdin stops it.
    this.stdin.on("finish", () => setTimeout(() => this.exit(0), 0));
  }

  write(event: Record<string, unknown>): void {
    this.stdout.write(`${JSON.stringify(event)}\n`);
  }

  exit(code: number | null): void {
    if (this.listenerCount("exit") === 0) return;
    this.emit("exit", code);
    this.removeAllListeners("exit");
  }

  kill(): boolean {
    this.killed = true;
    this.exit(null);
    return true;
  }
}

/** Lets readline deliver lines written to the fake's stdout. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("LiveContextService", () => {
  let root: string;
  let helper: FakeHelper;
  let events: LiveContextEvent[];
  let service: LiveContextService;
  let unavailable: "disabled" | null;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "pine-live-context-"));
    events = [];
    unavailable = null;
    service = new LiveContextService({
      unavailableReason: () => unavailable,
      spawnHelper: () => {
        helper = new FakeHelper();
        return helper;
      },
      projectRoot: () => root,
      emit: (event) => events.push(event),
      volatileIntervalMs: 1,
      stopTimeoutMs: 50,
    });
  });

  afterEach(async () => {
    service.dispose();
    await rm(root, { recursive: true, force: true });
  });

  async function startListening(): Promise<void> {
    await service.start({
      projectId: PROJECT_ID,
      sessionId: "session-1",
      sources: ["mic", "system"],
      locale: "zh-CN",
    });
    helper.write({
      type: "status",
      state: "listening",
      startedAt: 1_000_000,
      sources: ["mic", "system"],
      locale: "zh-CN",
    });
    await tick();
  }

  it("reports why it is unavailable and refuses to start", async () => {
    unavailable = "disabled";
    expect(service.status()).toMatchObject({
      available: false,
      unavailableReason: "disabled",
      state: "idle",
    });
    await expect(
      service.start({
        projectId: PROJECT_ID,
        sessionId: "session-1",
        sources: ["mic"],
        locale: "en-US",
      }),
    ).rejects.toThrow(/unavailable/);
  });

  it("starts the helper and follows its status", async () => {
    await startListening();
    expect(helper.commands[0]).toEqual({
      type: "start",
      sources: ["mic", "system"],
      locale: "zh-CN",
    });
    expect(service.status()).toMatchObject({
      available: true,
      state: "listening",
      sessionId: "session-1",
      startedAt: 1_000_000,
    });
  });

  it("keeps one capture app-wide", async () => {
    await startListening();
    await expect(
      service.start({
        projectId: PROJECT_ID,
        sessionId: "session-2",
        sources: ["mic"],
        locale: "en-US",
      }),
    ).rejects.toThrow(/already/);
  });

  it("relays volatile text and saves only final segments, on the wall clock", async () => {
    await startListening();
    helper.write({
      type: "segment",
      id: "system-0",
      source: "system",
      t0: 1200,
      t1: 2000,
      text: "大家",
      final: false,
    });
    helper.write({
      type: "segment",
      id: "system-0",
      source: "system",
      t0: 1200,
      t1: 3400,
      text: "大家好",
      final: true,
    });
    await tick();

    const segments = events.flatMap((event) =>
      event.kind === "segment" ? [event.segment] : [],
    );
    expect(segments.map((segment) => [segment.text, segment.final])).toEqual([
      ["大家好", true],
    ]);
    expect(segments[0]).toMatchObject({
      source: "system",
      start: 1_001_200,
      end: 1_003_400,
    });

    const saved = await service.transcript({
      projectId: PROJECT_ID,
      sessionId: "session-1",
    });
    expect(saved).toEqual([segments[0]]);
    const file = await readFile(liveTranscriptPath(root, "session-1"), "utf8");
    expect(file).not.toMatch(/大家"/);
  });

  it("throttles volatile text to the latest per source", async () => {
    await startListening();
    for (const text of ["We", "We are", "We are live"])
      helper.write({
        type: "segment",
        id: "mic-0",
        source: "mic",
        t0: 0,
        t1: 100,
        text,
        final: false,
      });
    await tick();
    const volatile = events.flatMap((event) =>
      event.kind === "segment" && !event.segment.final
        ? [event.segment.text]
        : [],
    );
    expect(volatile).toEqual(["We are live"]);
  });

  it("stops by closing the helper's stdin and returns to idle", async () => {
    await startListening();
    const status = await service.stop();
    expect(helper.commands.at(-1)).toEqual({ type: "stop" });
    expect(status).toMatchObject({ state: "idle", sources: [] });
    expect(status.lastError).toBeUndefined();
  });

  it("reports a helper that dies on its own", async () => {
    await startListening();
    helper.exit(5);
    expect(service.status()).toMatchObject({
      state: "idle",
      lastError: { code: "helper_exited" },
    });
  });

  it("surfaces helper errors and a silent system source", async () => {
    await startListening();
    helper.write({
      type: "error",
      code: "permission_denied",
      message: "Microphone access is off for Pine.",
      source: "mic",
    });
    helper.write({ type: "status", state: "silent", source: "system" });
    await tick();
    expect(service.status()).toMatchObject({
      lastError: { code: "permission_denied", source: "mic" },
      systemSilent: true,
    });
  });

  it("deletes a session's transcript and rejects unsafe session ids", async () => {
    await startListening();
    helper.write({
      type: "segment",
      id: "mic-0",
      source: "mic",
      t0: 0,
      t1: 10,
      text: "hi",
      final: true,
    });
    await tick();
    await service.stop();
    await deleteLiveTranscript(root, "session-1");
    expect(
      await service.transcript({
        projectId: PROJECT_ID,
        sessionId: "session-1",
      }),
    ).toEqual([]);
    expect(() => liveTranscriptPath(root, "../escape")).toThrow();
  });
});
