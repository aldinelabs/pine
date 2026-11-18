import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LiveContextEvent } from "../../shared/liveContext";
import {
  deleteLiveTranscript,
  LiveContextService,
  liveTranscriptPath,
  liveVoicesPath,
  readTranscript,
  voicesForCapture,
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
    expect(saved.segments).toEqual([segments[0]]);
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
      (
        await service.transcript({
          projectId: PROJECT_ID,
          sessionId: "session-1",
        })
      ).segments,
    ).toEqual([]);
    expect(() => liveTranscriptPath(root, "../escape")).toThrow();
  });

  describe("speaker labels", () => {
    let models: (onProgress: (fraction: number) => void) => Promise<{
      segmentation: string;
      embedding: string;
    }>;
    let spawned: number;

    beforeEach(() => {
      spawned = 0;
      models = async (onProgress) => {
        onProgress(0.5);
        await tick();
        return { segmentation: "/m/seg.onnx", embedding: "/m/emb.onnx" };
      };
      service = new LiveContextService({
        unavailableReason: () => null,
        spawnHelper: () => {
          spawned += 1;
          helper = new FakeHelper();
          return helper;
        },
        projectRoot: () => root,
        emit: (event) => events.push(event),
        volatileIntervalMs: 1,
        stopTimeoutMs: 50,
        speakers: { available: () => true, models: (p) => models(p) },
      });
    });

    async function startWithSpeakers(): Promise<void> {
      await service.start({
        projectId: PROJECT_ID,
        sessionId: "session-1",
        sources: ["system"],
        locale: "zh-CN",
        speakers: true,
      });
      helper.write({
        type: "status",
        state: "listening",
        startedAt: 1_000_000,
        sources: ["system"],
        speakers: true,
      });
      await tick();
    }

    const target = { projectId: PROJECT_ID, sessionId: "session-1" };

    it("downloads the models first, then starts with them and the session's voices", async () => {
      // A merge from an earlier capture folds those two voices into one.
      await mkdir(path.dirname(liveVoicesPath(root, "session-1")), {
        recursive: true,
      });
      await writeFile(
        liveVoicesPath(root, "session-1"),
        JSON.stringify({
          v: 1,
          voices: {
            system: [
              { speaker: 1, centroid: [1, 0], count: 3 },
              { speaker: 2, centroid: [1, 0], count: 1 },
            ],
          },
        }),
      );
      await writeFile(
        liveTranscriptPath(root, "session-1"),
        `${JSON.stringify({ v: 1, type: "speaker-merge", from: "system-2", into: "system-1" })}\n`,
      );
      await startWithSpeakers();
      expect(
        events.some(
          (event) =>
            event.kind === "status" &&
            event.status.state === "downloading" &&
            event.status.download === "speakers" &&
            event.status.downloadProgress === 0.5,
        ),
      ).toBe(true);
      expect(helper.commands[0]).toMatchObject({
        type: "start",
        sources: ["system"],
        speakers: {
          segmentation: "/m/seg.onnx",
          embedding: "/m/emb.onnx",
          voices: { system: [{ speaker: 1, centroid: [1, 0], count: 4 }] },
        },
      });
      expect(service.status()).toMatchObject({
        state: "listening",
        speakers: true,
        speakersAvailable: true,
      });
    });

    it("starts without labels, and says why, when the models cannot be had", async () => {
      models = () => Promise.reject(new Error("offline"));
      await startWithSpeakers();
      expect(helper.commands[0]).not.toHaveProperty("speakers");
      expect(service.status()).toMatchObject({
        state: "listening",
        lastError: { code: "speaker_models_failed", message: "offline" },
      });
    });

    it("stops while the models download without starting the helper", async () => {
      let release: () => void = () => undefined;
      models = () =>
        new Promise((resolve) => {
          release = () => resolve({ segmentation: "/s", embedding: "/e" });
        });
      const starting = service.start({
        projectId: PROJECT_ID,
        sessionId: "session-1",
        sources: ["mic"],
        locale: "en-US",
        speakers: true,
      });
      await tick();
      expect(service.status().state).toBe("preparing");
      await expect(service.stop()).resolves.toMatchObject({ state: "idle" });
      release();
      await starting;
      expect(spawned).toBe(0);
      expect(service.status().state).toBe("idle");
    });

    it("saves labels with final segments and appends later relabels", async () => {
      await startWithSpeakers();
      // A label for text still forming waits for the final version.
      helper.write({
        type: "speaker",
        id: "system-0",
        source: "system",
        speaker: 1,
        turns: [{ offset: 0, speaker: 1 }],
      });
      helper.write({
        type: "segment",
        id: "system-0",
        source: "system",
        t0: 0,
        t1: 3000,
        text: "大家好。好的。",
        final: true,
      });
      await tick();
      // Then the speaker change inside it is found.
      helper.write({
        type: "speaker",
        id: "system-0",
        source: "system",
        speaker: 1,
        turns: [
          { offset: 0, speaker: 1 },
          { offset: 4, speaker: 2 },
        ],
        confidence: 0.8,
      });
      await tick();

      const turnsEvents = events.flatMap((event) =>
        event.kind === "turns" ? [event.turns] : [],
      );
      expect(turnsEvents).toEqual([
        [{ offset: 0, speaker: "system-1" }],
        [
          { offset: 0, speaker: "system-1" },
          { offset: 4, speaker: "system-2" },
        ],
      ]);
      const finalSegment = events.find(
        (event) => event.kind === "segment" && event.segment.final,
      );
      expect(finalSegment).toMatchObject({
        segment: { turns: [{ offset: 0, speaker: "system-1" }] },
      });

      const lines = (
        await readFile(liveTranscriptPath(root, "session-1"), "utf8")
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({ text: "大家好。好的。" });
      expect(lines[0]).not.toHaveProperty("type");
      expect(lines[1]).toMatchObject({ type: "turns" });

      const { segments } = await service.transcript(target);
      expect(segments[0]?.turns).toEqual([
        { offset: 0, speaker: "system-1" },
        { offset: 4, speaker: "system-2" },
      ]);
    });

    it("keeps the helper's voice prints per session and deletes them with it", async () => {
      await startWithSpeakers();
      helper.write({
        type: "voices",
        source: "system",
        voices: [{ speaker: 1, centroid: [0.6, 0.8], count: 4 }],
      });
      await service.stop();
      const saved = JSON.parse(
        await readFile(liveVoicesPath(root, "session-1"), "utf8"),
      ) as { voices: Record<string, unknown> };
      expect(saved.voices.system).toEqual([
        { speaker: 1, centroid: [0.6, 0.8], count: 4 },
      ]);
      await deleteLiveTranscript(root, "session-1");
      await expect(
        readFile(liveVoicesPath(root, "session-1"), "utf8"),
      ).rejects.toThrow();
    });

    it("renames and merges speakers by appending records", async () => {
      await startWithSpeakers();
      await service.renameSpeaker({
        ...target,
        speaker: "system-1",
        name: "Alice",
      });
      const merged = await service.mergeSpeakers({
        ...target,
        from: "system-2",
        into: "system-1",
      });
      expect(merged).toEqual({
        names: { "system-1": "Alice" },
        merges: { "system-2": "system-1" },
      });
      expect(events.filter((event) => event.kind === "speakers")).toHaveLength(
        2,
      );
      expect((await service.transcript(target)).speakers).toEqual(merged);
    });
  });

  it("reads old transcripts and ignores records it does not know", () => {
    const transcript = readTranscript(
      [
        JSON.stringify({
          v: 1,
          id: "a",
          source: "mic",
          start: 1,
          end: 2,
          text: "hi",
        }),
        "not json",
        JSON.stringify({ v: 1, type: "turns", id: "missing", turns: [] }),
        JSON.stringify({
          v: 1,
          type: "turns",
          id: "a",
          turns: [
            { offset: 0, speaker: "mic-2" },
            { offset: 1, speaker: "bad" },
          ],
        }),
        JSON.stringify({
          v: 1,
          type: "speaker-name",
          speaker: "mic-2",
          name: "Kim",
        }),
        JSON.stringify({ v: 1, type: "future-thing" }),
      ].join("\n"),
    );
    expect(transcript.segments).toEqual([
      {
        id: "a",
        source: "mic",
        start: 1,
        end: 2,
        text: "hi",
        final: true,
        turns: [{ offset: 0, speaker: "mic-2" }],
      },
    ]);
    expect(transcript.speakers.names).toEqual({ "mic-2": "Kim" });
  });

  it("folds merged voices within a source before the next capture", () => {
    const voices = voicesForCapture(
      {
        system: [
          { speaker: 1, centroid: [1, 0], count: 1 },
          { speaker: 2, centroid: [0, 1], count: 1 },
          { speaker: 3, centroid: [0, 1], count: 2 },
        ],
      },
      { "system-2": "system-1", "system-3": "mic-1" },
    );
    expect(voices.system).toHaveLength(2);
    expect(voices.system?.[0]?.speaker).toBe(1);
    expect(voices.system?.[0]?.count).toBe(2);
    expect(voices.system?.[0]?.centroid[0]).toBeCloseTo(Math.SQRT1_2);
    // Merged into the other source: kept as it was.
    expect(voices.system?.[1]).toMatchObject({ speaker: 3, count: 2 });
  });
});
