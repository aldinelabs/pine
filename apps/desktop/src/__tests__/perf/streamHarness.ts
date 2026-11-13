/*
 * Count-based instruments for the streaming perf tests (`*.perf.test.ts`).
 *
 * The goal they guard: what one streaming flush costs must not depend on how
 * long the conversation already is. happy-dom has no layout and no paint, so
 * nothing here measures time. Every instrument counts something instead:
 * transcript reads, component updates, function calls, animation frames,
 * layout reads and DOM mutations. Production code stays untouched; the
 * counters live in this file, in `vi.mock` wrappers and in mount options.
 */
import { createApp, type ComponentPublicInstance } from "vue";
import { vi } from "vitest";
import type {
  PineAssistantMessageUpdate,
  PineJsonValue,
  PineSessionEvent,
} from "@/shared/agent";
import type { PineTranscriptMessage } from "@/stores/session";

// -----------------------------------------------------------------------------
// 1. History whose reads are counted
// -----------------------------------------------------------------------------

let historyReadCount = 0;

/** Reads of `id`, `role`, `blocks` and `status` on seeded history so far. */
export function historyReads(): number {
  return historyReadCount;
}

export function resetHistoryReads(): void {
  historyReadCount = 0;
}

function countedProperty<Value>(value: Value): PropertyDescriptor {
  return {
    configurable: true,
    enumerable: true,
    get(): Value {
      historyReadCount += 1;
      return value;
    },
  };
}

/**
 * `count` finished transcript messages, alternating user and assistant. The
 * store keeps messages raw in a `shallowRef`, so a scan over the transcript
 * shows up as reads proportional to its length, while copying the array
 * (which is all a streaming update should do) reads nothing.
 *
 * `start` continues the numbering, for seeding in chunks.
 */
export function seedHistory(
  count: number,
  options: { start?: number; prefix?: string } = {},
): PineTranscriptMessage[] {
  const start = options.start ?? 0;
  const prefix = options.prefix ?? "history";
  return Array.from({ length: count }, (_, offset) => {
    const index = start + offset;
    const message = { createdAt: "2026-09-03T00:00:00.000Z" };
    Object.defineProperties(message, {
      id: countedProperty(`${prefix}-${index}`),
      role: countedProperty(index % 2 === 0 ? "user" : "assistant"),
      blocks: countedProperty([
        { type: "text", text: `History message ${index}.` },
      ]),
      status: countedProperty("complete"),
    });
    return message as PineTranscriptMessage;
  });
}

// -----------------------------------------------------------------------------
// 2. Session events through the real entry point
// -----------------------------------------------------------------------------

type SessionEventListener = (event: PineSessionEvent) => void;

/**
 * Define `window.pine` with an `onSessionEvent` that captures every listener,
 * so events reach the store the way they do in the app. `api` adds the other
 * preload methods a test needs.
 */
export function installSessionEvents(api: Record<string, unknown> = {}) {
  const listeners = new Set<SessionEventListener>();
  let subscriptions = 0;
  const pine = {
    ...api,
    onSessionEvent(listener: SessionEventListener): () => void {
      subscriptions += 1;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  Object.defineProperty(window, "pine", { configurable: true, value: pine });
  return {
    pine,
    emit(event: PineSessionEvent): void {
      for (const listener of [...listeners]) listener(event);
    },
    /** How many times anything subscribed, including since removed ones. */
    subscriptionCount: (): number => subscriptions,
    listenerCount: (): number => listeners.size,
  };
}

// -----------------------------------------------------------------------------
// 3. Stream event builders
// -----------------------------------------------------------------------------

const STREAM_TIMESTAMP = Date.parse("2026-09-03T00:00:00.000Z");

/** Builders for the events one streaming assistant message produces. */
export function streamEvents({
  sessionId,
  messageId,
}: {
  sessionId: string;
  messageId: string;
}) {
  const update = (
    ...updates: PineAssistantMessageUpdate[]
  ): PineSessionEvent => ({
    type: "message-update",
    sessionId,
    messageId,
    updates,
  });
  const message = (
    type: "message-start" | "message-end",
    content: PineJsonValue[],
  ): PineSessionEvent => ({
    type,
    sessionId,
    messageId,
    message: { role: "assistant", content, timestamp: STREAM_TIMESTAMP },
  });
  return {
    running: (): PineSessionEvent => ({
      type: "run-state",
      sessionId,
      state: "running",
    }),
    idle: (): PineSessionEvent => ({
      type: "run-state",
      sessionId,
      state: "idle",
    }),
    /** The user's prompt, as the agent echoes it before the reply. */
    userMessage: (id: string, text: string): PineSessionEvent[] =>
      (["message-start", "message-end"] as const).map((type) => ({
        type,
        sessionId,
        messageId: id,
        message: { role: "user", content: text, timestamp: STREAM_TIMESTAMP },
      })),
    messageStart: (content: PineJsonValue[] = []): PineSessionEvent =>
      message("message-start", content),
    /** One 120 ms flush carrying any updates. */
    update,
    thinkingDelta: (delta: string, contentIndex = 0): PineSessionEvent =>
      update({ type: "thinking-delta", contentIndex, delta }),
    textDelta: (delta: string, contentIndex = 0): PineSessionEvent =>
      update({ type: "text-delta", contentIndex, delta }),
    toolCallStart: (
      id: string,
      name: string,
      contentIndex = 0,
    ): PineSessionEvent =>
      update({ type: "tool-call-start", contentIndex, id, name }),
    /** Without `input` this is what streams past the argument preview cap. */
    toolCallDelta: (
      delta: string,
      contentIndex = 0,
      input?: PineJsonValue,
    ): PineSessionEvent =>
      update({
        type: "tool-call-delta",
        contentIndex,
        delta,
        ...(input === undefined ? {} : { input }),
      }),
    messageEnd: (content: PineJsonValue[]): PineSessionEvent =>
      message("message-end", content),
  };
}

// -----------------------------------------------------------------------------
// 4. Component mounts and updates
// -----------------------------------------------------------------------------

function componentName(instance: ComponentPublicInstance): string {
  const options = instance.$options as { __name?: string; name?: string };
  return options.__name ?? options.name ?? "Anonymous";
}

function bump(counts: Map<string, number>, name: string, by = 1): void {
  counts.set(name, (counts.get(name) ?? 0) + by);
}

interface ComponentUpdate {
  name: string;
  root: Node | null;
  ancestors: Set<string>;
}

function ancestorNames(instance: ComponentPublicInstance): Set<string> {
  const names = new Set<string>();
  for (let parent = instance.$parent; parent; parent = parent.$parent)
    names.add(componentName(parent));
  return names;
}

/**
 * A mixin for `mount(..., { global: { mixins: [counter.mixin] } })` that
 * counts lifecycle hooks of every component under the mount, keyed by
 * component name. An `updated` hook means that component's render ran again.
 *
 * A component handed a new prop object re-runs its own render even when it
 * produces the same output, so "this subtree stayed settled" is asked with
 * `updatesUnder` / `updatesInside`, which leave the subtree's root out.
 */
export function componentCounter() {
  const live = new Map<string, number>();
  const mounts = new Map<string, number>();
  const updates = new Map<string, number>();
  const updateLog: ComponentUpdate[] = [];
  const mixin = {
    mounted(this: ComponentPublicInstance): void {
      const name = componentName(this);
      bump(live, name);
      bump(mounts, name);
    },
    updated(this: ComponentPublicInstance): void {
      const name = componentName(this);
      bump(updates, name);
      updateLog.push({
        name,
        root: this.$el as Node | null,
        ancestors: ancestorNames(this),
      });
    },
    unmounted(this: ComponentPublicInstance): void {
      bump(live, componentName(this), -1);
    },
  };
  return {
    mixin,
    /** `updated` hooks of that component since the last reset. */
    updates: (name: string): number => updates.get(name) ?? 0,
    /** Instances of that component mounted right now. */
    mountedCount: (name: string): number => live.get(name) ?? 0,
    /** Every component with instances mounted right now, with its count. */
    mountedTable: (): Record<string, number> =>
      Object.fromEntries([...live].filter(([, count]) => count > 0)),
    /** `mounted` hooks of that component since the last reset. */
    mounts: (name: string): number => mounts.get(name) ?? 0,
    /**
     * `updated` hooks, since the last reset, of components rendered strictly
     * inside an element matching `selector`. The component whose own root
     * matches is not counted: it may re-run and reuse everything below it.
     */
    updatesInside(selector: string): number {
      return updateLog.filter(({ root }) =>
        root?.parentElement?.closest(selector),
      ).length;
    },
    /**
     * `updated` hooks, since the last reset, of components that descend from
     * a component with that name (not counting that component itself).
     */
    updatesUnder: (name: string): number =>
      updateLog.filter(({ ancestors }) => ancestors.has(name)).length,
    /** Every component updated since the last reset, with its count. */
    updateTable: (): Record<string, number> => Object.fromEntries(updates),
    /** Forget updates and mounts; instances stay counted as mounted. */
    reset(): void {
      mounts.clear();
      updates.clear();
      updateLog.length = 0;
    },
  };
}

// -----------------------------------------------------------------------------
// 5. Function calls
// -----------------------------------------------------------------------------

interface CallStats {
  calls: number;
  size: number;
}

const callStatsByWrapper = new WeakMap<object, CallStats>();

function stringSize(args: readonly unknown[]): number {
  let size = 0;
  for (const arg of args) if (typeof arg === "string") size += arg.length;
  return size;
}

/**
 * Wrap a function so its calls and the size of what it was handed are
 * counted (by default the length of its string arguments). Meant for module
 * mocks, which run before the test's own imports:
 *
 *   vi.mock("@/lib/animateScroll", async (original) => {
 *     const actual = await original<typeof import("@/lib/animateScroll")>();
 *     const { callCounter } = await import("@/__tests__/perf/streamHarness");
 *     return { ...actual, animateScrollTop: callCounter(actual.animateScrollTop) };
 *   });
 *
 * The test then reads `callStats(animateScrollTop)` from its normal import.
 */
export function callCounter<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
  sizeOf: (...args: Args) => number = (...args) => stringSize(args),
): (...args: Args) => Result {
  const stats: CallStats = { calls: 0, size: 0 };
  const wrapper = (...args: Args): Result => {
    stats.calls += 1;
    stats.size += sizeOf(...args);
    return fn(...args);
  };
  callStatsByWrapper.set(wrapper, stats);
  return wrapper;
}

/** The counters of a function wrapped by `callCounter`. */
export function callStats(wrapper: unknown) {
  const stats =
    typeof wrapper === "function" ? callStatsByWrapper.get(wrapper) : undefined;
  if (!stats) throw new Error("Not a callCounter wrapper.");
  return {
    calls: (): number => stats.calls,
    size: (): number => stats.size,
    reset(): void {
      stats.calls = 0;
      stats.size = 0;
    },
  };
}

const markdownParseStats = {
  fullParses: 0,
  fullCharacters: 0,
  streamParses: 0,
};
const countedParsers = new WeakSet<object>();

interface CountableMarkdownParser {
  parse: (source: string, ...rest: unknown[]) => unknown;
  stream?: { parse?: (source: string, ...rest: unknown[]) => unknown };
}

/**
 * Wrap `configurePineMarkdown` so every parser it configures counts what it
 * tokenises: `parse` re-reads its whole input, `stream.parse` is the
 * library's incremental path. Read the result with `markdownParses()`.
 */
export function countMarkdownParses<Parser extends object>(
  configure: (md: Parser) => Parser,
): (md: Parser) => Parser {
  return (md) => {
    const configured = configure(md);
    const parser = configured as unknown as CountableMarkdownParser;
    if (countedParsers.has(configured)) return configured;
    countedParsers.add(configured);
    const parse = parser.parse.bind(parser);
    parser.parse = (source, ...rest) => {
      markdownParseStats.fullParses += 1;
      markdownParseStats.fullCharacters += source.length;
      return parse(source, ...rest);
    };
    const stream = parser.stream;
    if (stream?.parse) {
      const streamParse = stream.parse.bind(stream);
      stream.parse = (source, ...rest) => {
        markdownParseStats.streamParses += 1;
        return streamParse(source, ...rest);
      };
    }
    return configured;
  };
}

export function markdownParses() {
  return {
    /** Full re-parses and the characters they were handed. */
    fullParses: (): number => markdownParseStats.fullParses,
    fullCharacters: (): number => markdownParseStats.fullCharacters,
    /** Calls into the incremental tokenizer. */
    streamParses: (): number => markdownParseStats.streamParses,
    reset(): void {
      markdownParseStats.fullParses = 0;
      markdownParseStats.fullCharacters = 0;
      markdownParseStats.streamParses = 0;
    },
  };
}

// -----------------------------------------------------------------------------
// 6. Frames, layout and observers
// -----------------------------------------------------------------------------

/** A display frame at 60 Hz, as the fake clock schedules them. */
export const FRAME_MS = 16;

/**
 * Set while a frame clock is installed: runs a callback at the start of the
 * next frame, ahead of the animation callbacks requested after this call,
 * without counting as a frame.
 */
let beforeNextFrame: ((callback: () => void) => void) | undefined;

const FRAME_CLOCK_START = Date.parse("2026-09-03T00:00:00.000Z");
let rendererPrimed = false;

/**
 * Fake timers that include `requestAnimationFrame` and `performance`, plus a
 * count of the animation frame callbacks that ran. A display-rate loop shows
 * up as about 60 frames per simulated second; an idle surface as none.
 */
export function frameClock(options: { now?: number } = {}) {
  // Vue arms a one-off 3 s devtools timer with its first app. Let that
  // happen on the real clock, so it never counts as a pending timer.
  if (!rendererPrimed) {
    rendererPrimed = true;
    createApp({ render: () => null });
  }
  vi.useFakeTimers({
    // A fixed start keeps the phase of the frames the same on every run.
    now: options.now ?? FRAME_CLOCK_START,
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
      "performance",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
  const request = globalThis.requestAnimationFrame;
  const cancel = globalThis.cancelAnimationFrame;
  const pending = new Set<number>();
  let run = 0;
  beforeNextFrame = (callback) => {
    request(() => callback());
  };
  globalThis.requestAnimationFrame = (callback) => {
    const id = request((time) => {
      pending.delete(id);
      run += 1;
      callback(time);
    });
    pending.add(id);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    pending.delete(id);
    cancel(id);
  };
  return {
    /** Advance simulated time, running timers, frames and microtasks. */
    async advance(ms: number): Promise<void> {
      await vi.advanceTimersByTimeAsync(ms);
    },
    /** Animation frame callbacks that ran since the last reset. */
    framesRun: (): number => run,
    /** Animation frames requested and not yet run or cancelled. */
    pendingFrames: (): number => pending.size,
    /** Pending timers of every kind, frames included. */
    pendingTimers: (): number => vi.getTimerCount(),
    now: (): number => performance.now(),
    resetFrames(): void {
      run = 0;
    },
    restore(): void {
      beforeNextFrame = undefined;
      vi.useRealTimers();
    },
  };
}

/**
 * Give an element the scroll metrics a browser would compute. `scrollTop`
 * clamps to the scroll range and counts its reads and writes. A write that
 * moves it dispatches one `scroll` event the way a browser does: at the
 * start of the next frame, before that frame's animation callbacks (in a
 * microtask when no frame clock is installed).
 */
export function layoutStub(
  element: HTMLElement,
  metrics: { scrollHeight: number; clientHeight: number },
) {
  const layout = { ...metrics };
  let top = 0;
  let reads = 0;
  let writes = 0;
  let scrollQueued = false;
  const maxTop = () => Math.max(0, layout.scrollHeight - layout.clientHeight);
  const moveTo = (value: number): void => {
    const next = Math.min(maxTop(), Math.max(0, value));
    if (next === top) return;
    top = next;
    if (scrollQueued) return;
    scrollQueued = true;
    (beforeNextFrame ?? queueMicrotask)(() => {
      scrollQueued = false;
      element.dispatchEvent(new Event("scroll"));
    });
  };
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, get: () => layout.scrollHeight },
    clientHeight: { configurable: true, get: () => layout.clientHeight },
    scrollTop: {
      configurable: true,
      get(): number {
        reads += 1;
        return top;
      },
      set(value: number) {
        writes += 1;
        moveTo(value);
      },
    },
    scrollTo: {
      configurable: true,
      value(options?: ScrollToOptions | number, y?: number): void {
        writes += 1;
        moveTo(typeof options === "number" ? (y ?? 0) : (options?.top ?? top));
      },
    },
  });
  return {
    /** Change what layout reports, as growing content would. */
    set(next: Partial<typeof metrics>): void {
      Object.assign(layout, next);
      // A shrinking scroll range clamps the position without a write.
      if (top > maxTop()) top = maxTop();
    },
    scrollHeight: (): number => layout.scrollHeight,
    /** The current position, without counting as a read. */
    scrollTop: (): number => top,
    maxScrollTop: maxTop,
    scrollTopReads: (): number => reads,
    scrollTopWrites: (): number => writes,
    reset(): void {
      reads = 0;
      writes = 0;
    },
  };
}

/**
 * Count the layout reads that force style or layout in a browser:
 * `getComputedStyle` and `getBoundingClientRect`. Each rectangle read keeps
 * its element and the simulated time, so reads can be grouped into passes.
 */
export function layoutReadSpy() {
  const rectReads: { element: Element; time: number }[] = [];
  let computedStyles = 0;
  const computedStyle = window.getComputedStyle.bind(window);
  const restoreComputedStyle = vi
    .spyOn(window, "getComputedStyle")
    .mockImplementation((...args) => {
      computedStyles += 1;
      return computedStyle(...args);
    });
  let owner: object = HTMLElement.prototype;
  while (!Object.hasOwn(owner, "getBoundingClientRect")) {
    const parent: unknown = Object.getPrototypeOf(owner);
    if (typeof parent !== "object" || parent === null)
      throw new Error("getBoundingClientRect is not defined.");
    owner = parent;
  }
  const prototype = owner as Element;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- re-bound below
  const boundingRect = prototype.getBoundingClientRect;
  const restoreRect = vi
    .spyOn(prototype, "getBoundingClientRect")
    .mockImplementation(function (this: Element) {
      rectReads.push({ element: this, time: performance.now() });
      return boundingRect.call(this);
    });
  const matching = (filter?: (element: Element) => boolean) =>
    filter ? rectReads.filter(({ element }) => filter(element)) : rectReads;
  return {
    computedStyleCalls: (): number => computedStyles,
    rectCalls: (filter?: (element: Element) => boolean): number =>
      matching(filter).length,
    /**
     * Distinct simulated instants at which a matching rectangle was read:
     * one per frame or timer callback that measured, however many elements
     * it walked.
     */
    rectPasses: (filter?: (element: Element) => boolean): number =>
      new Set(matching(filter).map(({ time }) => time)).size,
    reset(): void {
      computedStyles = 0;
      rectReads.length = 0;
    },
    restore(): void {
      restoreComputedStyle.mockRestore();
      restoreRect.mockRestore();
    },
  };
}

interface StubbedResizeObserver {
  callback: ResizeObserverCallback;
  observer: ResizeObserver;
  targets: Set<Element>;
}

/** An entry carrying the element's current (stubbed) box. */
function resizeEntry(target: Element): ResizeObserverEntry {
  const contentRect = target.getBoundingClientRect();
  const size = [
    { blockSize: contentRect.height, inlineSize: contentRect.width },
  ];
  return {
    target,
    contentRect,
    borderBoxSize: size,
    contentBoxSize: size,
    devicePixelContentBoxSize: size,
  };
}

/**
 * Replace `ResizeObserver` with one that records its instances and only
 * reports when `fire()` is called, which stands in for a layout pass.
 */
export function resizeObserverStub() {
  const original = globalThis.ResizeObserver;
  const instances: StubbedResizeObserver[] = [];
  class ResizeObserverStub {
    private readonly record: StubbedResizeObserver;
    constructor(callback: ResizeObserverCallback) {
      this.record = {
        callback,
        observer: this,
        targets: new Set(),
      };
      instances.push(this.record);
    }
    observe(target: Element): void {
      this.record.targets.add(target);
    }
    unobserve(target: Element): void {
      this.record.targets.delete(target);
    }
    disconnect(): void {
      this.record.targets.clear();
    }
  }
  globalThis.ResizeObserver = ResizeObserverStub;
  return {
    instances,
    /** Elements observed right now, across every instance. */
    observed: (): Element[] =>
      instances.flatMap((instance) => [...instance.targets]),
    /**
     * Report a resize to every observer of a matching element (of any
     * element when no filter is given). Returns how many were notified.
     */
    fire(filter?: (target: Element) => boolean): number {
      let notified = 0;
      for (const instance of [...instances]) {
        const targets = [...instance.targets].filter(
          (target) => filter?.(target) ?? true,
        );
        if (targets.length === 0) continue;
        notified += 1;
        instance.callback(targets.map(resizeEntry), instance.observer);
      }
      return notified;
    },
    restore(): void {
      globalThis.ResizeObserver = original;
    },
  };
}

/**
 * Replace `IntersectionObserver` with one that reports only what the test
 * tells it to, since happy-dom lays nothing out. `report` stands in for the
 * browser telling each observer which of its targets are on screen.
 */
export function intersectionObserverStub() {
  const original = globalThis.IntersectionObserver;
  const instances: {
    callback: IntersectionObserverCallback;
    observer: IntersectionObserver;
    targets: Set<Element>;
  }[] = [];
  class IntersectionObserverStub {
    private readonly targets = new Set<Element>();
    constructor(callback: IntersectionObserverCallback) {
      instances.push({
        callback,
        observer: this as unknown as IntersectionObserver,
        targets: this.targets,
      });
    }
    observe(target: Element): void {
      this.targets.add(target);
    }
    unobserve(target: Element): void {
      this.targets.delete(target);
    }
    disconnect(): void {
      this.targets.clear();
    }
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  globalThis.IntersectionObserver =
    IntersectionObserverStub as unknown as typeof IntersectionObserver;
  return {
    report(isIntersecting: (target: Element) => boolean): void {
      for (const instance of [...instances]) {
        if (instance.targets.size === 0) continue;
        instance.callback(
          [...instance.targets].map(
            (target) =>
              ({
                target,
                isIntersecting: isIntersecting(target),
              }) as IntersectionObserverEntry,
          ),
          instance.observer,
        );
      }
    },
    restore(): void {
      globalThis.IntersectionObserver = original;
    },
  };
}

// -----------------------------------------------------------------------------
// 7. DOM mutations and reporting
// -----------------------------------------------------------------------------

/**
 * Count DOM mutation records under `root`, split by whether they landed
 * inside a given element. Mutations outside the streaming message are work
 * leaking into settled history.
 */
export function mutationCounter(root: Node) {
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((batch) => {
    records.push(...batch);
  });
  observer.observe(root, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
  const collect = (): MutationRecord[] => {
    records.push(...observer.takeRecords());
    return records;
  };
  return {
    total: (): number => collect().length,
    inside: (element: Node | null): number =>
      collect().filter((record) => element?.contains(record.target) ?? false)
        .length,
    outside: (element: Node | null): number =>
      collect().filter((record) => !(element?.contains(record.target) ?? false))
        .length,
    reset(): void {
      collect().length = 0;
    },
    disconnect(): void {
      observer.disconnect();
    },
  };
}

/**
 * Print a test's measurements when `PINE_PERF_LOG=1`. Run from a coding
 * agent, vitest hides the output of passing tests; add `--reporter=default`.
 */
export function reportMetrics(
  name: string,
  table: Record<string, number | string | boolean>,
): void {
  if (process.env.PINE_PERF_LOG !== "1") return;
  console.log(`[perf] ${name} ${JSON.stringify(table)}`);
}
