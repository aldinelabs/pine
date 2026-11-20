import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LiveTranslationRequest,
  LiveTranslationResult,
} from "../../shared/liveTranslation";
import {
  LiveTranslator,
  type LiveTranslatedSegment,
  type LiveTranslatorOptions,
} from "../liveContextTranslation";

interface Deferred {
  request: LiveTranslationRequest;
  resolve(result: LiveTranslationResult): void;
  reject(error: Error): void;
}

const segment = (n: number, text = `segment ${n}`) => ({ id: `s${n}`, text });

describe("LiveTranslator", () => {
  let calls: Deferred[];
  let translated: LiveTranslatedSegment[];
  let pending: string[][];
  let errors: (string | undefined)[];

  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    translated = [];
    pending = [];
    errors = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function create(
    options: Partial<LiveTranslatorOptions> = {},
  ): LiveTranslator {
    return new LiveTranslator({
      language: "fr-FR",
      sourceLanguage: "en-US",
      translate: (request) =>
        new Promise((resolve, reject) =>
          calls.push({ request, resolve, reject }),
        ),
      translated: (segments) => translated.push(...segments),
      pending: (ids) => pending.push(ids),
      error: (error) => errors.push(error),
      timing: {
        settleMs: 1_000,
        maxWaitMs: 3_000,
        minIntervalMs: 500,
        batchSegments: 3,
        batchChars: 1_000,
        catchUpSegments: 10,
        catchUpChars: 10_000,
        maxQueue: 20,
        retryMs: [1_000, 2_000],
      },
      ...options,
    });
  }

  /** Answers a request by echoing each segment with a prefix. */
  async function answer(call: Deferred | undefined): Promise<void> {
    call?.resolve({
      translations: call.request.segments.map((text) => `fr:${text}`),
    });
    await vi.advanceTimersByTimeAsync(0);
  }

  it("waits for the speech to settle, then sends one batch", async () => {
    const translator = create();
    translator.add([segment(1)]);
    await vi.advanceTimersByTimeAsync(600);
    translator.add([segment(2)]);
    await vi.advanceTimersByTimeAsync(900);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].request).toEqual({
      language: "fr-FR",
      sourceLanguage: "en-US",
      context: [],
      segments: ["segment 1", "segment 2"],
    });
    expect(pending.at(-1)).toEqual(["s1", "s2"]);

    await answer(calls[0]);
    expect(translated).toEqual([
      { id: "s1", text: "segment 1", translation: "fr:segment 1" },
      { id: "s2", text: "segment 2", translation: "fr:segment 2" },
    ]);
    expect(pending.at(-1)).toEqual([]);
  });

  it("sends a full batch at once and never waits past maxWait", async () => {
    const translator = create();
    translator.add([segment(1), segment(2), segment(3)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    await answer(calls[0]);

    // Steady speech never settles; the oldest waits at most maxWait.
    for (let n = 4; n < 6; n += 1) {
      translator.add([segment(n)]);
      await vi.advanceTimersByTimeAsync(900);
    }
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_300);
    expect(calls).toHaveLength(2);
    expect(calls[1].request.segments).toEqual(["segment 4", "segment 5"]);
  });

  it("passes the last translations as context", async () => {
    const translator = create();
    translator.add([segment(1), segment(2), segment(3)]);
    await vi.advanceTimersByTimeAsync(0);
    await answer(calls[0]);
    translator.add([segment(4)]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls[1].request.context).toEqual([
      { text: "segment 1", translation: "fr:segment 1" },
      { text: "segment 2", translation: "fr:segment 2" },
      { text: "segment 3", translation: "fr:segment 3" },
    ]);
  });

  it("keeps one request at a time and catches up in a bigger batch", async () => {
    const translator = create();
    translator.add([segment(1), segment(2), segment(3)]);
    await vi.advanceTimersByTimeAsync(0);
    for (let n = 4; n <= 10; n += 1) translator.add([segment(n)]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toHaveLength(1);
    expect(pending.at(-1)).toHaveLength(10);

    await answer(calls[0]);
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toHaveLength(2);
    expect(calls[1].request.segments).toHaveLength(7);
  });

  it("drops the oldest waiting segments when far behind", () => {
    const translator = create({
      timing: { maxQueue: 4, batchSegments: 100, settleMs: 10_000 },
    });
    translator.add([1, 2, 3, 4, 5, 6].map((n) => segment(n)));
    expect(pending.at(-1)).toEqual(["s3", "s4", "s5", "s6"]);
  });

  it("translates a segment once, again only when its text changes", async () => {
    const translator = create();
    translator.add([segment(1)]);
    translator.add([segment(1)]);
    translator.add([{ id: "s2", text: "  " }]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls[0].request.segments).toEqual(["segment 1"]);
    await answer(calls[0]);

    translator.add([segment(1)]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toHaveLength(1);
    translator.add([segment(1, "segment one, corrected")]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls[1].request.segments).toEqual(["segment one, corrected"]);
  });

  it("retries a failed batch with backoff, reports it, then recovers", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const translator = create();
    translator.add([segment(1), segment(2), segment(3)]);
    await vi.advanceTimersByTimeAsync(0);
    calls[0].reject(new Error("rate limited"));
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toEqual(["failed"]);
    expect(pending.at(-1)).toEqual(["s1", "s2", "s3"]);

    await vi.advanceTimersByTimeAsync(900);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toHaveLength(2);
    expect(calls[1].request.segments).toHaveLength(3);
    await answer(calls[1]);
    expect(errors).toEqual(["failed", undefined]);
    expect(translated).toHaveLength(3);
    warn.mockRestore();
  });

  it("gives up on a batch after its retries", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const translator = create();
    translator.add([segment(1), segment(2), segment(3)]);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await vi.advanceTimersByTimeAsync(2_000);
      calls[attempt].reject(new Error("down"));
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(calls).toHaveLength(3);
    expect(pending.at(-1)).toEqual([]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(3);
    warn.mockRestore();
  });

  it("stops asking when there is no model", async () => {
    const translator = create();
    translator.add([segment(1)]);
    await vi.advanceTimersByTimeAsync(1_000);
    calls[0].resolve({ error: "no_model" });
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toEqual(["no_model"]);
    expect(pending.at(-1)).toEqual([]);
    translator.add([segment(2)]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toHaveLength(1);
  });

  it("skips segments the model left out", async () => {
    const translator = create();
    translator.add([segment(1), segment(2)]);
    await vi.advanceTimersByTimeAsync(1_000);
    calls[0].resolve({ translations: ["", "fr:2"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(translated).toEqual([
      { id: "s2", text: "segment 2", translation: "fr:2" },
    ]);
  });

  it("cancels: nothing waits and a late reply is ignored", async () => {
    const translator = create();
    translator.add([segment(1), segment(2), segment(3)]);
    await vi.advanceTimersByTimeAsync(0);
    translator.add([segment(4)]);
    translator.cancel();
    expect(pending.at(-1)).toEqual([]);
    await answer(calls[0]);
    expect(translated).toEqual([]);
    translator.add([segment(5)]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toHaveLength(1);
  });
});
