import type { LiveContextTranslationError } from "../shared/liveContext";
import {
  LIVE_TRANSLATION_LIMITS,
  type LiveTranslationRequest,
  type LiveTranslationResult,
} from "../shared/liveTranslation";

/** A final segment to translate. */
export interface LiveTranslatorSegment {
  id: string;
  text: string;
}

/** A segment and its translation, for saving and showing. */
export interface LiveTranslatedSegment extends LiveTranslatorSegment {
  translation: string;
}

/**
 * How the translator paces itself. A batch goes out once the speech
 * settles (no new final segment for `settleMs`), once a segment has waited
 * `maxWaitMs`, or as soon as it is full; requests never overlap and are at
 * least `minIntervalMs` apart. Behind by more than a batch, it sends bigger
 * catch-up batches; beyond `maxQueue` waiting segments the oldest are
 * dropped untranslated. A failed batch is retried after each of
 * `retryMs`, then dropped, and later batches keep the longest delay until
 * one succeeds.
 */
export interface LiveTranslatorTiming {
  settleMs: number;
  maxWaitMs: number;
  minIntervalMs: number;
  batchSegments: number;
  batchChars: number;
  catchUpSegments: number;
  catchUpChars: number;
  maxQueue: number;
  retryMs: readonly number[];
}

export const LIVE_TRANSLATOR_TIMING: LiveTranslatorTiming = {
  settleMs: 1_200,
  maxWaitMs: 4_000,
  minIntervalMs: 1_000,
  batchSegments: 6,
  batchChars: 1_200,
  catchUpSegments: 24,
  catchUpChars: 4_800,
  maxQueue: 200,
  retryMs: [2_000, 8_000, 30_000],
};

export interface LiveTranslatorOptions {
  /** The language to translate into. */
  language: string;
  /** The language the speech is transcribed in. */
  sourceLanguage?: string;
  translate(request: LiveTranslationRequest): Promise<LiveTranslationResult>;
  /** Segments translated, in order. */
  translated(segments: LiveTranslatedSegment[]): void;
  /** Every segment still waiting (queued or being translated). */
  pending(ids: string[]): void;
  /** Translation stopped working, or (undefined) works again. */
  error(error: LiveContextTranslationError | undefined): void;
  timing?: Partial<LiveTranslatorTiming>;
}

interface Queued extends LiveTranslatorSegment {
  queuedAt: number;
}

/**
 * Translates one capture's final segments as they come, in small batches
 * with the last few translations as context. Volatile text never reaches
 * it. A segment is translated once; only a changed text translates again.
 */
export class LiveTranslator {
  private readonly timing: LiveTranslatorTiming;
  private queue: Queued[] = [];
  private inFlight: Queued[] | undefined;
  /** Text last queued per segment, so a segment goes out once per text. */
  private readonly seen = new Map<string, string>();
  private readonly history: { text: string; translation: string }[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastAddAt = 0;
  private lastRequestAt = Number.NEGATIVE_INFINITY;
  private retryAt = 0;
  private failures = 0;
  private failing = false;
  /** Cancelled, or no model: nothing more goes out. */
  private stopped = false;

  constructor(private readonly options: LiveTranslatorOptions) {
    this.timing = { ...LIVE_TRANSLATOR_TIMING, ...options.timing };
  }

  get language(): string {
    return this.options.language;
  }

  /** Queues final segments; repeats and empty text are skipped. */
  add(segments: readonly LiveTranslatorSegment[]): void {
    if (this.stopped) return;
    const now = Date.now();
    let added = false;
    for (const { id, text } of segments) {
      const trimmed = text.trim();
      if (!trimmed || this.seen.get(id) === trimmed) continue;
      this.seen.set(id, trimmed);
      this.queue = this.queue.filter((queued) => queued.id !== id);
      this.queue.push({
        id,
        text: trimmed.slice(0, LIVE_TRANSLATION_LIMITS.segmentLength),
        queuedAt: now,
      });
      added = true;
    }
    if (!added) return;
    this.lastAddAt = now;
    // Far behind: the oldest give way, untranslated.
    if (this.queue.length > this.timing.maxQueue)
      this.queue.splice(0, this.queue.length - this.timing.maxQueue);
    this.emitPending();
    this.schedule();
  }

  /** Stops for good: nothing waits, and a reply on its way is ignored. */
  cancel(): void {
    if (this.stopped && !this.queue.length && !this.inFlight) return;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.queue = [];
    this.inFlight = undefined;
    this.options.pending([]);
  }

  private emitPending(): void {
    this.options.pending([
      ...(this.inFlight ?? []).map(({ id }) => id),
      ...this.queue.map(({ id }) => id),
    ]);
  }

  private isFull(): boolean {
    let chars = 0;
    for (const { text } of this.queue) chars += text.length;
    return (
      this.queue.length >= this.timing.batchSegments ||
      chars >= this.timing.batchChars
    );
  }

  private schedule(): void {
    if (this.stopped || this.inFlight || !this.queue.length) return;
    if (this.timer) clearTimeout(this.timer);
    const now = Date.now();
    const ready = this.isFull()
      ? now
      : Math.min(
          this.lastAddAt + this.timing.settleMs,
          this.queue[0].queuedAt + this.timing.maxWaitMs,
        );
    const at = Math.max(
      ready,
      this.lastRequestAt + this.timing.minIntervalMs,
      this.retryAt,
    );
    this.timer = setTimeout(() => void this.flush(), Math.max(0, at - now));
  }

  /** The next batch: a normal one, or a bigger one when behind. */
  private takeBatch(): Queued[] {
    const behind = this.queue.length > this.timing.batchSegments;
    const maxSegments = Math.min(
      behind ? this.timing.catchUpSegments : this.timing.batchSegments,
      LIVE_TRANSLATION_LIMITS.segments,
    );
    const maxChars = behind ? this.timing.catchUpChars : this.timing.batchChars;
    let count = 0;
    let chars = 0;
    while (count < this.queue.length && count < maxSegments) {
      const length = this.queue[count].text.length;
      if (count > 0 && chars + length > maxChars) break;
      chars += length;
      count += 1;
    }
    return this.queue.splice(0, count);
  }

  private async flush(): Promise<void> {
    this.timer = undefined;
    if (this.stopped || this.inFlight || !this.queue.length) return;
    const batch = this.takeBatch();
    this.inFlight = batch;
    this.lastRequestAt = Date.now();
    const request: LiveTranslationRequest = {
      language: this.options.language,
      ...(this.options.sourceLanguage
        ? { sourceLanguage: this.options.sourceLanguage }
        : {}),
      context: this.history.slice(-LIVE_TRANSLATION_LIMITS.contextSegments),
      segments: batch.map(({ text }) => text),
    };
    let result: LiveTranslationResult | undefined;
    try {
      result = await this.options.translate(request);
    } catch (error) {
      console.warn("Live Context translation failed.", error);
    }
    // Cancelled meanwhile: the reply is not wanted.
    if (this.inFlight !== batch) return;
    this.inFlight = undefined;

    if (result && "error" in result) {
      this.stopped = true;
      this.queue = [];
      this.options.pending([]);
      this.options.error(result.error);
      return;
    }
    if (result) {
      this.failures = 0;
      this.retryAt = 0;
      if (this.failing) {
        this.failing = false;
        this.options.error(undefined);
      }
      const done: LiveTranslatedSegment[] = [];
      batch.forEach((segment, index) => {
        const translation = result.translations[index]?.trim();
        if (translation) done.push({ ...segment, translation });
      });
      for (const { text, translation } of done)
        this.history.push({ text, translation });
      this.history.splice(
        0,
        Math.max(
          0,
          this.history.length - LIVE_TRANSLATION_LIMITS.contextSegments,
        ),
      );
      // Strip the queue bookkeeping before handing them on.
      if (done.length)
        this.options.translated(
          done.map(({ id, text, translation }) => ({ id, text, translation })),
        );
    } else {
      this.failures += 1;
      if (!this.failing) {
        this.failing = true;
        this.options.error("failed");
      }
      const retries = this.timing.retryMs;
      const delay = retries[Math.min(this.failures, retries.length) - 1] ?? 0;
      this.retryAt = Date.now() + delay;
      // Retried a few times, then given up on; later batches still try.
      if (this.failures <= retries.length) this.queue.unshift(...batch);
    }
    this.emitPending();
    this.schedule();
  }
}
