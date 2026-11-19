import { createPinia, setActivePinia } from "pinia";
import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LiveContextEvent,
  LiveContextSegment,
  LiveContextStatus,
} from "@/shared/liveContext";
import { useLiveContextStore } from "../liveContext";

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
});
