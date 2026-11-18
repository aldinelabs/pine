import { createPinia, setActivePinia } from "pinia";
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

  beforeEach(() => {
    const api = {
      status: vi.fn().mockResolvedValue({ ...listening, state: "idle" }),
      start: vi.fn().mockResolvedValue(listening),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
      transcript: vi.fn().mockResolvedValue([segment("saved", true, "old")]),
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
});
