import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeFloat16 } from "../liveContextDiarizer";
import type { LiveContextEvent } from "../../shared/liveContext";
import {
  deleteLiveTranscript,
  LiveContextService,
  liveTranscriptPath,
  liveSpeakersPath,
  readSpeakerRecords,
  readTranscript,
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

    it("downloads the models first, then starts with them", async () => {
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
        speakers: { segmentation: "/m/seg.onnx", embedding: "/m/emb.onnx" },
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

    /** One voice talking for `seconds`, as the helper measures it. */
    function speak(
      vector: Float32Array,
      from: number,
      seconds: number,
      firstId: number,
    ) {
      const vectorText = encodeFloat16(vector);
      let id = firstId;
      helper.write({
        type: "window",
        source: "system",
        id,
        t0: Math.max(0, from - 7),
        t1: from + 3,
        slow: true,
        turns: [[from, from + 3, 0]],
      });
      helper.write({
        type: "embedding",
        source: "system",
        window: id,
        local: 0,
        t0: from,
        t1: from + 3,
        seconds: 3,
        quality: 1,
        vector: vectorText,
      });
      for (let end = from + 4.5; end <= from + seconds; end += 1.5) {
        id += 1;
        helper.write({
          type: "window",
          source: "system",
          id,
          t0: end - 3,
          t1: end,
          slow: false,
          turns: [[end - 3, end, 0]],
          after: id - 1,
        });
        helper.write({
          type: "embedding",
          source: "system",
          window: id,
          local: 0,
          t0: end - 3,
          t1: end,
          seconds: 3,
          quality: 1,
          vector: vectorText,
        });
      }
      return id + 1;
    }

    const voiceA = Float32Array.from({ length: 16 }, (_, i) =>
      i === 0 ? 1 : 0.05,
    );
    const voiceB = Float32Array.from({ length: 16 }, (_, i) =>
      i === 1 ? 1 : 0.05,
    );

    it("labels segments from the helper's measurements, saves them, and finishes at stop", async () => {
      await startWithSpeakers();
      const next = speak(voiceA, 0.5, 9, 0);
      helper.write({
        type: "segment",
        id: "system-0",
        source: "system",
        t0: 500,
        t1: 9000,
        a0: 0.5,
        a1: 9,
        words: [
          [0, 0.5, 4],
          [4, 4, 9],
        ],
        text: "大家好。好的。",
        final: true,
      });
      await tick();
      speak(voiceB, 10, 9, next);
      helper.write({
        type: "segment",
        id: "system-1",
        source: "system",
        t0: 10000,
        t1: 19000,
        a0: 10,
        a1: 19,
        words: [[0, 10, 19]],
        text: "我补充一下。",
        final: true,
      });
      await tick();
      const final = events.flatMap((event) =>
        event.kind === "segment" && event.segment.final ? [event.segment] : [],
      );
      expect(final.map((segment) => segment.turns?.[0]?.speaker)).toEqual([
        "system-1",
        "system-2",
      ]);
      await service.stop();
      const { segments } = await service.transcript(target);
      expect(segments.map((segment) => segment.turns)).toEqual([
        [{ offset: 0, speaker: "system-1" }],
        [{ offset: 0, speaker: "system-2" }],
      ]);
      // The speaker file keeps the measurements and the final pass, not audio.
      const records = readSpeakerRecords(
        await readFile(liveSpeakersPath(root, "session-1"), "utf8"),
      );
      expect(new Set(records.map((record) => record.type))).toEqual(
        new Set(["capture", "window", "embedding", "segment", "relabel"]),
      );
      await deleteLiveTranscript(root, "session-1");
      await expect(
        readFile(liveSpeakersPath(root, "session-1"), "utf8"),
      ).rejects.toThrow();
    });

    it("keeps the same speaker numbers in a later capture of the session", async () => {
      await startWithSpeakers();
      speak(voiceA, 0.5, 9, 0);
      speak(voiceB, 10, 9, 100);
      await tick();
      await service.stop();
      events.length = 0;
      await startWithSpeakers();
      // Window ids and analyzer time restart with each capture.
      speak(voiceB, 0.5, 6, 0);
      helper.write({
        type: "segment",
        id: "system-0",
        source: "system",
        t0: 500,
        t1: 6000,
        a0: 0.5,
        a1: 6,
        words: [[0, 0.5, 6]],
        text: "又是我。",
        final: true,
      });
      await tick();
      const final = events.find(
        (event) => event.kind === "segment" && event.segment.final,
      );
      expect(final).toMatchObject({
        segment: { turns: [{ offset: 0, speaker: "system-2" }] },
      });
    });

    it("reports when labels are scaled back to keep the Mac cool", async () => {
      await startWithSpeakers();
      helper.write({ type: "speakers-state", level: 2, reason: "thermal" });
      await tick();
      expect(service.status().speakersDegraded).toBe("reduced");
      helper.write({ type: "speakers-state", level: 4, reason: "thermal" });
      await tick();
      expect(service.status().speakersDegraded).toBe("paused");
      helper.write({ type: "speakers-state", level: 0, reason: null });
      await tick();
      expect(service.status().speakersDegraded).toBeUndefined();
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
        JSON.stringify({
          v: 1,
          type: "speaker-alias",
          from: "mic-3",
          into: "mic-2",
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
    expect(transcript.speakers.aliases).toEqual({ "mic-3": "mic-2" });
  });

  it("reads unknown, provisional, overlapping and echo labels", () => {
    const { segments } = readTranscript(
      [
        JSON.stringify({
          v: 1,
          id: "a",
          source: "mic",
          start: 1,
          end: 2,
          text: "嗯，对对对",
        }),
        JSON.stringify({
          v: 1,
          type: "turns",
          id: "a",
          echo: true,
          turns: [
            { offset: 0, provisional: true },
            { offset: 2, speaker: "mic-1", overlap: "mic-2" },
          ],
        }),
      ].join("\n"),
    );
    expect(segments[0]).toMatchObject({
      echo: true,
      turns: [
        { offset: 0, provisional: true },
        { offset: 2, speaker: "mic-1", overlap: "mic-2" },
      ],
    });
  });
});
