import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFloat16 } from "../liveContextDiarizer";
import type { LiveContextEvent } from "../../shared/liveContext";
import { LIVE_CONTEXT_SPEAKER_NAME_MAX } from "../../shared/liveContextSpeakers";
import type {
  LiveTranslationRequest,
  LiveTranslationResult,
} from "../../shared/liveTranslation";
import {
  deleteLiveTranscript,
  LiveContextService,
  liveTranscriptPath,
  liveSpeakersPath,
  liveTranslationsPath,
  readTranslations,
  textHash,
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
  let unavailable: "platform" | null;

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
    unavailable = "platform";
    expect(service.status()).toMatchObject({
      available: false,
      unavailableReason: "platform",
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

  it("gives the agent its own session's transcript and capture", async () => {
    await startListening();
    helper.write({
      type: "segment",
      id: "system-0",
      source: "system",
      t0: 0,
      t1: 900,
      text: "First point.",
      final: true,
    });
    await tick();

    const here = await service.agentSource({
      projectId: PROJECT_ID,
      sessionId: "session-1",
    });
    expect(here.transcript.segments.map((segment) => segment.text)).toEqual([
      "First point.",
    ]);
    expect(here.capture).toEqual({
      state: "listening",
      sources: ["mic", "system"],
    });

    // Another session sees neither this capture nor its words.
    const elsewhere = await service.agentSource({
      projectId: PROJECT_ID,
      sessionId: "session-2",
    });
    expect(elsewhere.capture).toBeUndefined();
    expect(elsewhere.transcript.segments).toEqual([]);

    await service.stop();
    const stopped = await service.agentSource({
      projectId: PROJECT_ID,
      sessionId: "session-1",
    });
    expect(stopped.capture).toBeUndefined();
    expect(stopped.transcript.segments).toHaveLength(1);
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

  it("broadcasts input levels while listening and never saves them", async () => {
    await startListening();
    helper.write({
      type: "level",
      levels: {
        mic: { rms: 0.02, peak: 0.4 },
        system: { rms: 2, peak: "loud" },
        other: { rms: 0.5, peak: 0.5 },
      },
    });
    await tick();
    expect(events.filter((event) => event.kind === "levels")).toEqual([
      {
        kind: "levels",
        levels: {
          mic: { rms: 0.02, peak: 0.4 },
          system: { rms: 1, peak: 0 },
        },
      },
    ]);
    helper.write({ type: "status", state: "paused" });
    helper.write({ type: "level", levels: { mic: { rms: 0.1, peak: 0.2 } } });
    await tick();
    expect(events.filter((event) => event.kind === "levels")).toHaveLength(1);
    await service.stop();
    const saved = await service.transcript({
      projectId: PROJECT_ID,
      sessionId: "session-1",
    });
    expect(saved.segments).toEqual([]);
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

  it("deletes a transcript on request, stopping its capture first", async () => {
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
    const target = { projectId: PROJECT_ID, sessionId: "session-1" };
    const file = liveTranscriptPath(root, "session-1");
    await expect(readFile(file, "utf8")).resolves.toContain("hi");
    const status = await service.deleteTranscript(target);
    expect(helper.commands.at(-1)).toEqual({ type: "stop" });
    expect(status).toMatchObject({ state: "idle" });
    await expect(readFile(file, "utf8")).rejects.toThrow();
    await expect(
      readFile(liveSpeakersPath(root, "session-1"), "utf8"),
    ).rejects.toThrow();
    expect((await service.transcript(target)).segments).toEqual([]);
    expect(events.at(-1)).toEqual({ kind: "deleted", sessionId: "session-1" });
  });

  it("deletes another session's transcript without stopping the capture", async () => {
    await startListening();
    const status = await service.deleteTranscript({
      projectId: PROJECT_ID,
      sessionId: "session-2",
    });
    expect(status).toMatchObject({
      state: "listening",
      sessionId: "session-1",
    });
    expect(helper.commands.some(({ type }) => type === "stop")).toBe(false);
  });

  describe("translation", () => {
    const target = { projectId: PROJECT_ID, sessionId: "session-1" };
    let requests: LiveTranslationRequest[];
    let reply: (
      request: LiveTranslationRequest,
    ) => Promise<LiveTranslationResult>;

    beforeEach(() => {
      requests = [];
      reply = (request) =>
        Promise.resolve({
          translations: request.segments.map((text) => `fr:${text}`),
        });
      service.dispose();
      service = new LiveContextService({
        unavailableReason: () => null,
        spawnHelper: () => {
          helper = new FakeHelper();
          return helper;
        },
        projectRoot: () => root,
        emit: (event) => events.push(event),
        volatileIntervalMs: 1,
        stopTimeoutMs: 50,
        translate: (request) => {
          requests.push(request);
          return reply(request);
        },
        translationTiming: { settleMs: 5, maxWaitMs: 20, minIntervalMs: 0 },
      });
    });

    async function listen(translation?: string): Promise<void> {
      await service.start({
        ...target,
        sources: ["mic"],
        locale: "en-US",
        ...(translation ? { translation } : {}),
      });
      helper.write({
        type: "status",
        state: "listening",
        startedAt: 1_000_000,
        sources: ["mic"],
        locale: "en-US",
      });
      await tick();
    }

    function say(id: string, text: string, final = true): void {
      helper.write({
        type: "segment",
        id,
        source: "mic",
        t0: 0,
        t1: 10,
        text,
        final,
      });
    }

    const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

    it("translates final segments only, in a batch, and keeps them", async () => {
      await listen("fr-FR");
      expect(service.status().translation).toEqual({ language: "fr-FR" });
      say("mic-0", "Hello every", false);
      say("mic-0", "Hello everyone.");
      say("mic-1", "Let's start", false);
      say("mic-1", "Let's start.");
      say("mic-2", "Still talk", false);
      await tick();
      await settle();

      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        language: "fr-FR",
        sourceLanguage: "en-US",
        segments: ["Hello everyone.", "Let's start."],
      });
      const ids = events.flatMap((event) =>
        event.kind === "segment" && event.segment.final
          ? [event.segment.id]
          : [],
      );
      expect(
        events.filter((event) => event.kind === "translation").at(-1),
      ).toEqual({
        kind: "translation",
        sessionId: "session-1",
        language: "fr-FR",
        translations: {},
        pending: [],
      });
      const saved = await service.transcript(target);
      expect(saved.translations).toEqual({
        "fr-FR": {
          [ids[0]]: "fr:Hello everyone.",
          [ids[1]]: "fr:Let's start.",
        },
      });
      const file = await readFile(
        liveTranslationsPath(root, "session-1"),
        "utf8",
      );
      expect(
        file
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line)),
      ).toEqual([
        {
          v: 1,
          id: ids[0],
          lang: "fr-FR",
          hash: textHash("Hello everyone."),
          text: "fr:Hello everyone.",
        },
        {
          v: 1,
          id: ids[1],
          lang: "fr-FR",
          hash: textHash("Let's start."),
          text: "fr:Let's start.",
        },
      ]);
    });

    it("does not translate again when speakers change", async () => {
      await listen("fr-FR");
      say("mic-0", "Hello everyone.");
      await tick();
      await settle();
      await service.mergeSpeakers({ ...target, from: "mic-2", into: "mic-1" });
      await service.renameSpeaker({ ...target, speaker: "mic-1", name: "Ana" });
      await settle();
      expect(requests).toHaveLength(1);
    });

    it("never translates into the language spoken", async () => {
      await listen("en-US");
      say("mic-0", "Hello everyone.");
      await tick();
      await settle();
      expect(requests).toHaveLength(0);
      expect(service.status().translation).toBeUndefined();
    });

    it("stops on Stop: a late reply is not kept", async () => {
      let resolve: (result: LiveTranslationResult) => void = () => undefined;
      reply = () => new Promise((done) => (resolve = done));
      await listen("fr-FR");
      say("mic-0", "Hello everyone.");
      await tick();
      await settle();
      expect(requests).toHaveLength(1);
      await service.stop();
      resolve({ translations: ["fr:Hello everyone."] });
      await settle();
      expect((await service.transcript(target)).translations).toBeUndefined();
      expect(service.status().translation).toBeUndefined();
    });

    it("turns on mid-capture, catching up on recent segments, and off again", async () => {
      await listen();
      say("mic-0", "Hello everyone.");
      say("mic-1", "Let's start.");
      await tick();
      await settle();
      expect(requests).toHaveLength(0);

      service.setTranslation({ ...target, language: "de-DE" });
      expect(service.status().translation).toEqual({ language: "de-DE" });
      await settle();
      expect(requests[0]?.segments).toEqual([
        "Hello everyone.",
        "Let's start.",
      ]);

      service.setTranslation({ ...target, language: null });
      expect(service.status().translation).toBeUndefined();
      say("mic-2", "Next item.");
      await tick();
      await settle();
      expect(requests).toHaveLength(1);
      // Another conversation's request changes nothing here.
      service.setTranslation({
        sessionId: "session-2",
        projectId: PROJECT_ID,
        language: "de-DE",
      });
      expect(service.status().translation).toBeUndefined();
    });

    it("reports a missing model and keeps transcribing", async () => {
      reply = () => Promise.resolve({ error: "no_model" });
      await listen("fr-FR");
      say("mic-0", "Hello everyone.");
      await tick();
      await settle();
      expect(service.status()).toMatchObject({
        state: "listening",
        translation: { language: "fr-FR", error: "no_model" },
      });
      say("mic-1", "Let's start.");
      await tick();
      expect((await service.transcript(target)).segments).toHaveLength(2);
    });

    it("deletes the translations with the transcript", async () => {
      await listen("fr-FR");
      say("mic-0", "Hello everyone.");
      await tick();
      await settle();
      const file = liveTranslationsPath(root, "session-1");
      await expect(readFile(file, "utf8")).resolves.toContain("fr:");
      await service.deleteTranscript(target);
      await expect(readFile(file, "utf8")).rejects.toThrow();
    });

    it("shows only translations that match their segment's text", () => {
      const segments = [
        {
          id: "a",
          source: "mic" as const,
          start: 0,
          end: 1,
          text: "One",
          final: true,
        },
        {
          id: "b",
          source: "mic" as const,
          start: 1,
          end: 2,
          text: "Two",
          final: true,
        },
      ];
      const record = (id: string, text: string, translation: string) =>
        JSON.stringify({
          v: 1,
          id,
          lang: "fr-FR",
          hash: textHash(text),
          text: translation,
        });
      expect(
        readTranslations(
          [
            record("a", "One", "Un"),
            record("b", "Too", "Trop"),
            "{broken",
            record("a", "One", "Un !"),
          ].join("\n"),
          segments,
        ),
      ).toEqual({ "fr-FR": { a: "Un !" } });
    });
  });

  describe("speaker labels", () => {
    let models: () => { segmentation: string; embedding: string };

    beforeEach(() => {
      models = () => ({
        segmentation: "/m/seg.onnx",
        embedding: "/m/emb.onnx",
      });
      service = new LiveContextService({
        unavailableReason: () => null,
        spawnHelper: () => {
          helper = new FakeHelper();
          return helper;
        },
        projectRoot: () => root,
        emit: (event) => events.push(event),
        volatileIntervalMs: 1,
        stopTimeoutMs: 50,
        speakers: {
          available: () => true,
          models: () => models(),
        },
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

    it("starts with the bundled models, without downloading anything", async () => {
      await startWithSpeakers();
      expect(
        events.some(
          (event) =>
            event.kind === "status" && event.status.state === "downloading",
        ),
      ).toBe(false);
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

    it("starts without labels, and says so, when they cannot start", async () => {
      models = () => {
        throw new Error("The speaker models are missing.");
      };
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      await startWithSpeakers();
      expect(helper.commands[0]).not.toHaveProperty("speakers");
      expect(service.status()).toMatchObject({
        state: "listening",
        lastError: { code: "speakers_unavailable" },
      });
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
      i === 0 ? 1 : 0.02,
    );
    const voiceB = Float32Array.from({ length: 16 }, (_, i) =>
      i === 1 ? 1 : 0.02,
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

    it("keeps a trimmed, capped name past Stop, and clears it back", async () => {
      await startWithSpeakers();
      await service.renameSpeaker({
        ...target,
        speaker: "system-1",
        name: `  ${"名".repeat(60)}  `,
      });
      await service.stop();
      const saved = (await service.transcript(target)).speakers;
      expect(saved.names["system-1"]).toBe(
        "名".repeat(LIVE_CONTEXT_SPEAKER_NAME_MAX),
      );
      const cleared = await service.renameSpeaker({
        ...target,
        speaker: "system-1",
        name: "   ",
      });
      expect(cleared.names).toEqual({});
      expect((await service.transcript(target)).speakers.names).toEqual({});
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
