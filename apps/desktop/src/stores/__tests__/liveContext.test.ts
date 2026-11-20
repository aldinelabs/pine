import { createPinia, setActivePinia } from "pinia";
import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type {
  LiveContextEvent,
  LiveContextSegment,
  LiveContextSource,
  LiveContextStatus,
} from "@/shared/liveContext";
import {
  LIVE_CONTEXT_TRANSLATION_PREFERENCE_KEY,
  useLiveContextStore,
} from "../liveContext";

const TARGET = {
  projectId: "00000000-0000-4000-8000-000000000001",
  sessionId: "session-1",
};

const listening: LiveContextStatus = {
  available: true,
  state: "listening",
  sessionId: TARGET.sessionId,
  projectId: TARGET.projectId,
  sources: ["mic"],
  startedAt: 0,
};

function segment(
  text: string,
  final: boolean,
  id = "c-mic-0",
): LiveContextSegment {
  return { id, source: "mic", start: 0, end: 1, text, final };
}

describe("useLiveContextStore", () => {
  let emit: (event: LiveContextEvent) => void;
  let api: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    api = {
      status: vi.fn().mockResolvedValue({
        ...listening,
        state: "idle",
        speakersAvailable: true,
      }),
      start: vi.fn().mockResolvedValue(listening),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
      transcript: vi.fn().mockResolvedValue({
        segments: [segment("saved", true, "old")],
        speakers: { names: {}, merges: {} },
      }),
      renameSpeaker: vi.fn().mockResolvedValue({
        names: { "mic-1": "Alice" },
        merges: {},
      }),
      mergeSpeakers: vi.fn().mockResolvedValue({
        names: {},
        merges: { "mic-2": "mic-1" },
      }),
      deleteTranscript: vi.fn().mockResolvedValue({
        ...listening,
        state: "idle",
      }),
      setTranslation: vi.fn().mockResolvedValue({
        ...listening,
        translation: { language: "fr-FR" },
      }),
      subscribe: vi.fn((listener: (event: LiveContextEvent) => void) => {
        emit = listener;
        return () => undefined;
      }),
    };
    vi.stubGlobal("pine", { liveContext: api });
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("counts listening time without the pauses", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(10_000);
      const store = useLiveContextStore();
      await flushPromises();
      const started = { ...listening, startedAt: 10_000 };
      emit({ kind: "status", status: started });
      vi.setSystemTime(40_000);
      emit({ kind: "status", status: { ...started, state: "paused" } });
      vi.setSystemTime(100_000);
      // Paused: the clock stands still.
      expect(store.elapsedAt(Date.now())).toBe(30_000);
      emit({ kind: "status", status: started });
      expect(store.elapsedAt(105_000)).toBe(35_000);
      emit({ kind: "status", status: { ...started, state: "idle" } });
      expect(store.elapsedAt(105_000)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the privacy settings for a source", async () => {
    api.openPrivacySettings = vi.fn().mockResolvedValue(undefined);
    await useLiveContextStore().openPrivacySettings("system");
    expect(api.openPrivacySettings).toHaveBeenCalledWith("system");
  });

  it("is unavailable without the desktop API", () => {
    vi.stubGlobal("pine", {});
    setActivePinia(createPinia());
    expect(useLiveContextStore().available).toBe(false);
  });

  it("sends reactive sources as a request IPC can clone", async () => {
    const store = useLiveContextStore();
    const sources = ref<LiveContextSource[]>(["mic", "system"]);

    await store.start(TARGET, sources.value, "en-US");

    const request: unknown = api.start.mock.lastCall?.[0];
    // Electron rejects a Proxy in an IPC message ("An object could not be
    // cloned."), as structuredClone does.
    expect(() => structuredClone(request)).not.toThrow();
    expect(request).toEqual(
      expect.objectContaining({ sources: ["mic", "system"] }),
    );
  });

  it("shows volatile text in the capturing session until its final version", async () => {
    const store = useLiveContextStore();
    await store.load(TARGET);
    await store.start(TARGET, ["mic"], "en-US");

    emit({
      kind: "segment",
      sessionId: TARGET.sessionId,
      segment: segment("We", false),
    });
    expect(store.volatileOf(TARGET.sessionId).map(({ text }) => text)).toEqual([
      "We",
    ]);
    expect(store.volatileOf("other-session")).toEqual([]);

    const final = segment("We are live.", true);
    emit({ kind: "segment", sessionId: TARGET.sessionId, segment: final });
    emit({ kind: "segment", sessionId: TARGET.sessionId, segment: final });
    expect(store.volatileOf(TARGET.sessionId)).toEqual([]);
    expect(store.segmentsOf(TARGET.sessionId).map(({ text }) => text)).toEqual([
      "saved",
      "We are live.",
    ]);
  });

  it("drops volatile text when the capture ends", async () => {
    const store = useLiveContextStore();
    await store.start(TARGET, ["mic"], "en-US");
    emit({
      kind: "segment",
      sessionId: TARGET.sessionId,
      segment: segment("half", false),
    });
    emit({ kind: "status", status: { ...listening, state: "idle" } });
    expect(store.isCapturing).toBe(false);
    expect(store.volatileOf(TARGET.sessionId)).toEqual([]);
  });

  it("keeps the last few seconds of input levels until the capture ends", async () => {
    let now = 1_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const store = useLiveContextStore();
    await store.start(TARGET, ["mic"], "en-US");
    emit({ kind: "levels", levels: { mic: { rms: 0.1, peak: 0.2 } } });
    now += 4_000;
    emit({ kind: "levels", levels: { mic: { rms: 0.3, peak: 0.5 } } });
    expect(store.levelHistory().map(({ at }) => at)).toEqual([1_000, 5_000]);
    // Older than the history window: dropped.
    now += 3_000;
    emit({ kind: "levels", levels: { mic: { rms: 0, peak: 0 } } });
    expect(store.levelHistory().map(({ at }) => at)).toEqual([5_000, 8_000]);
    emit({ kind: "status", status: { ...listening, state: "idle" } });
    expect(store.levelHistory()).toEqual([]);
    vi.restoreAllMocks();
  });

  it("asks for speaker labels only when the user opted in", async () => {
    const store = useLiveContextStore();
    await flushPromises();
    await store.start(TARGET, ["mic"], "en-US");
    expect(api.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ speakers: false }),
    );
    store.identifySpeakers = true;
    api.status.mockResolvedValue({ ...listening, state: "idle" });
    setActivePinia(createPinia());
    const fresh = useLiveContextStore();
    await flushPromises();
    fresh.identifySpeakers = true;
    await fresh.start(TARGET, ["mic"], "en-US");
    // This build cannot label speakers: nothing is asked for.
    expect(api.start).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ speakers: true }),
    );
  });

  it("applies labels to forming and final text", async () => {
    const store = useLiveContextStore();
    await store.load(TARGET);
    await store.start(TARGET, ["mic"], "en-US");
    emit({
      kind: "segment",
      sessionId: TARGET.sessionId,
      segment: segment("We", false),
    });
    const turns = [{ offset: 0, speaker: "mic-1" as const }];
    emit({
      kind: "turns",
      sessionId: TARGET.sessionId,
      segmentId: "c-mic-0",
      turns,
    });
    expect(store.volatileOf(TARGET.sessionId)[0]?.turns).toEqual(turns);

    // The final version keeps a label that came first.
    emit({
      kind: "segment",
      sessionId: TARGET.sessionId,
      segment: segment("We are live.", true),
    });
    expect(store.segmentsOf(TARGET.sessionId)[1]?.turns).toEqual(turns);

    const relabeled = [
      { offset: 0, speaker: "mic-1" as const },
      { offset: 3, speaker: "mic-2" as const },
    ];
    emit({
      kind: "turns",
      sessionId: TARGET.sessionId,
      segmentId: "c-mic-0",
      turns: relabeled,
    });
    expect(store.segmentsOf(TARGET.sessionId)[1]?.turns).toEqual(relabeled);
    expect(store.segmentsOf(TARGET.sessionId)[1]?.echo).toBeUndefined();

    emit({
      kind: "turns",
      sessionId: TARGET.sessionId,
      segmentId: "c-mic-0",
      turns: relabeled,
      echo: true,
    });
    expect(store.segmentsOf(TARGET.sessionId)[1]?.echo).toBe(true);
    emit({
      kind: "turns",
      sessionId: TARGET.sessionId,
      segmentId: "c-mic-0",
      turns: relabeled,
    });
    expect(store.segmentsOf(TARGET.sessionId)[1]?.echo).toBeUndefined();
  });

  it("renames and merges speakers through the API", async () => {
    const store = useLiveContextStore();
    await store.load(TARGET);
    await store.renameSpeaker(TARGET, "mic-1", "Alice");
    expect(api.renameSpeaker).toHaveBeenCalledWith({
      ...TARGET,
      speaker: "mic-1",
      name: "Alice",
    });
    expect(store.speakersOf(TARGET.sessionId).names).toEqual({
      "mic-1": "Alice",
    });
    await store.mergeSpeakers(TARGET, "mic-2", "mic-1");
    expect(store.speakersOf(TARGET.sessionId).merges).toEqual({
      "mic-2": "mic-1",
    });
    emit({
      kind: "speakers",
      sessionId: TARGET.sessionId,
      speakers: { names: { "mic-1": "Bo" }, merges: {} },
    });
    expect(store.speakersOf(TARGET.sessionId).names).toEqual({ "mic-1": "Bo" });
  });

  it("deletes a transcript and forgets it, here and in other windows", async () => {
    const store = useLiveContextStore();
    await store.load(TARGET);
    await store.renameSpeaker(TARGET, "mic-1", "Alice");
    expect(store.segmentsOf(TARGET.sessionId)).toHaveLength(1);
    await store.deleteTranscript(TARGET);
    expect(api.deleteTranscript).toHaveBeenCalledWith(TARGET);
    expect(store.status.state).toBe("idle");
    expect(store.segmentsOf(TARGET.sessionId)).toEqual([]);
    expect(store.speakersOf(TARGET.sessionId).names).toEqual({});

    // Deleted in another window: the event clears this one's copy too.
    await store.load(TARGET);
    emit({ kind: "deleted", sessionId: TARGET.sessionId });
    expect(store.segmentsOf(TARGET.sessionId)).toEqual([]);
  });

  describe("translation", () => {
    beforeEach(() => window.localStorage.clear());

    it("keeps the translation choice for later windows", async () => {
      const store = useLiveContextStore();
      expect(store.translation).toEqual({ enabled: false });
      store.translation = { enabled: true, language: "ja-JP" };
      await flushPromises();
      expect(
        JSON.parse(
          window.localStorage.getItem(
            LIVE_CONTEXT_TRANSLATION_PREFERENCE_KEY,
          ) ?? "",
        ),
      ).toEqual({ enabled: true, language: "ja-JP" });

      setActivePinia(createPinia());
      expect(useLiveContextStore().translation).toEqual({
        enabled: true,
        language: "ja-JP",
      });
    });

    it("ignores a stored language Pine cannot translate into", () => {
      window.localStorage.setItem(
        LIVE_CONTEXT_TRANSLATION_PREFERENCE_KEY,
        JSON.stringify({ enabled: true, language: "xx-YY" }),
      );
      expect(useLiveContextStore().translation).toEqual({ enabled: true });
    });

    it("asks the capture to translate and follows what is pending", async () => {
      const store = useLiveContextStore();
      await store.start(TARGET, ["mic"], "en-US", "fr-FR");
      expect(api.start).toHaveBeenCalledWith(
        expect.objectContaining({ translation: "fr-FR" }),
      );

      emit({
        kind: "translation",
        sessionId: TARGET.sessionId,
        language: "fr-FR",
        translations: {},
        pending: ["a", "b"],
      });
      expect([...store.pendingTranslationsOf(TARGET.sessionId)]).toEqual([
        "a",
        "b",
      ]);
      emit({
        kind: "translation",
        sessionId: TARGET.sessionId,
        language: "fr-FR",
        translations: { a: "Bonjour" },
      });
      expect(store.translationsOf(TARGET.sessionId, "fr-FR")).toEqual({
        a: "Bonjour",
      });
      expect([...store.pendingTranslationsOf(TARGET.sessionId)]).toEqual(["b"]);

      emit({ kind: "status", status: { ...listening, state: "idle" } });
      expect(store.pendingTranslationsOf(TARGET.sessionId).size).toBe(0);
      expect(store.translationsOf(TARGET.sessionId, "fr-FR")).toEqual({
        a: "Bonjour",
      });
    });

    it("loads saved translations and drops them with the transcript", async () => {
      api.transcript.mockResolvedValue({
        segments: [segment("saved", true, "old")],
        speakers: { names: {}, merges: {} },
        translations: { "de-DE": { old: "gespeichert" } },
      });
      const store = useLiveContextStore();
      await store.load(TARGET);
      expect(store.translationsOf(TARGET.sessionId, "de-DE")).toEqual({
        old: "gespeichert",
      });
      await store.setTranslation(TARGET, "fr-FR");
      expect(api.setTranslation).toHaveBeenCalledWith({
        ...TARGET,
        language: "fr-FR",
      });
      expect(store.status.translation).toEqual({ language: "fr-FR" });

      await store.deleteTranscript(TARGET);
      expect(store.translationsOf(TARGET.sessionId, "de-DE")).toEqual({});
    });
  });
});
