/*
 * BASELINE: measured on the view before any perf change. The real
 * `ProjectSessionView` and session store run; the scroller parts, the row
 * (`ProjectTranscriptMessage`), the composer and the outline are stubs.
 * N = messages already loaded (seeded in chunks so the window trims as it
 * does in the app), K = 40 flushes into one streaming reply, W = mounted rows.
 *
 * | id | scenario                                | metric                                  | measured     | target          |
 * | -- | --------------------------------------- | --------------------------------------- | ------------ | --------------- |
 * | V1 | K flushes, N = 130 / N = 2,050          | history reads per flush                 | 241 / 241    | equal, <= 4 x W |
 * | V2 |                                         | row renders per flush                   | 1 / 1        | 1               |
 * | V2 |                                         | DOM mutations outside the streaming row | 0 / 0        | 0               |
 * | V3 |                                         | mounted rows (W)                        | 62 / 62      | <= 120          |
 * | V7 |                                         | ProjectSessionView updates per flush    | 0 / 0        | 0               |
 * | V4 | stop following, +100 messages, follow   | mounted rows                            | 60           | <= 120          |
 * | V5 | 10 flushes while the document is hidden | row renders per flush                   | 0            | 0               |
 * | V5 |                                         | row renders on return                   | 1            | 1               |
 * | V6 | reply ended, idle, 2 s later            | pending timers                          | 0            | 0               |
 *
 * Holds today: V1-V7. A target that is not met yet is written `it.fails`;
 * when a change makes one hold, turn it into `it` and update the measured
 * column.
 *
 * V1 was about 6 reads per loaded message per flush (window lookup, outline
 * turns, steering guard, tool-run scan; 961 / 12,481). Those are now O(1) or
 * cached per record; what remains is the `v-memo` sweep over the window, 4
 * reads per history row on average (240 here), plus the streaming message.
 *
 * Print the metrics with `PINE_PERF_LOG=1` (add `--reporter=default` when
 * vitest hides the output of passing tests).
 */
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { computed, defineComponent, h, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  componentCounter,
  frameClock,
  historyReads,
  installSessionEvents,
  mutationCounter,
  reportMetrics,
  resetHistoryReads,
  seedHistory,
  streamEvents,
} from "@/__tests__/perf/streamHarness";
import { createAppI18n } from "@/app/i18n";
import { useSessionStore, type PineTranscriptMessage } from "@/stores/session";
import ProjectSessionView from "../ProjectSessionView.vue";

const SESSION_ID = "session-perf";
const MESSAGE_ID = "live-assistant";
const FLUSHES = 40;
/** Both leave the same window: their difference is a multiple of the chunk. */
const HISTORY_SIZES = [130, 2_050] as const;
/** At most the view's RENDER_WINDOW_MAX, so every chunk gets a trim pass. */
const SEED_CHUNK = 120;
const RENDER_WINDOW_MAX = 120;

const activeTabId = ref("session-1");
/** What the scroller stub reports; the real one tracks the reader. */
const followingBottom = ref(true);
let rowRenders = 0;
const mountedViews: VueWrapper[] = [];

vi.mock("@/composables/useContentTabNavigation", () => ({
  useContentTabNavigation: () => ({
    activeTabId: computed(() => activeTabId.value),
    activate: vi.fn(),
    bindSession: vi.fn(),
    failPrompt: vi.fn(),
    tabs: ref([]),
  }),
}));

const slotStub = { template: "<div><slot /></div>" };

/** Exposes what `MessageScrollerProvider` does, driven by the test. */
const scrollerProviderStub = defineComponent({
  name: "MessageScrollerProvider",
  inheritAttrs: false,
  setup(_, { expose, slots }) {
    expose({
      followingBottom,
      isFollowingBottom: () => followingBottom.value,
    });
    return () => slots.default?.();
  },
});

/** One transcript row. It renders something that changes with its message. */
const rowStub = defineComponent({
  name: "ProjectTranscriptMessage",
  props: { message: { type: Object, required: true } },
  setup(props) {
    return () => {
      rowRenders += 1;
      const message = props.message as PineTranscriptMessage;
      const size = message.blocks.reduce(
        (total, block) =>
          total +
          (block.type === "text"
            ? block.text.length
            : block.type === "thinking"
              ? block.thinking.length
              : 1),
        0,
      );
      return h("div", { "data-slot": "row-stub" }, String(size));
    };
  },
});

let documentVisibilityStubbed = false;

/** What a hidden or minimised window reports to the page. */
function setDocumentVisibility(state: "hidden" | "visible"): void {
  documentVisibilityStubbed = true;
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => state === "hidden",
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  for (const view of mountedViews.splice(0)) view.unmount();
  if (documentVisibilityStubbed) {
    setDocumentVisibility("visible");
    Reflect.deleteProperty(document, "visibilityState");
    Reflect.deleteProperty(document, "hidden");
    documentVisibilityStubbed = false;
  }
  vi.useRealTimers();
});

async function mountView() {
  activeTabId.value = "session-1";
  followingBottom.value = true;
  const pinia = createPinia();
  setActivePinia(pinia);
  const events = installSessionEvents({
    getPathForFile: (file: File) => `/tmp/${file.name}`,
    openProject: ({ id }: { id: string }) =>
      Promise.resolve({ opened: true, project: { id } }),
  });
  const counter = componentCounter();
  const wrapper = mount(ProjectSessionView, {
    props: { projectId: "p1", tabId: "session-1", sessionId: SESSION_ID },
    global: {
      plugins: [pinia, createAppI18n("en-US")],
      mixins: [counter.mixin],
      stubs: {
        MessageScrollerProvider: scrollerProviderStub,
        MessageScroller: slotStub,
        MessageScrollerViewport: slotStub,
        MessageScrollerContent: {
          template: '<div><slot /><slot name="tail" /></div>',
        },
        MessageScrollerItem: slotStub,
        PineCharacter: true,
        ProjectSessionComposer: {
          name: "ProjectSessionComposer",
          template: '<div data-slot="composer-stub" />',
        },
        ProjectTranscriptMessage: rowStub,
        ProjectTranscriptOutline: {
          name: "ProjectTranscriptOutline",
          props: ["ensureMessageLoaded", "turns"],
          template: '<div data-slot="outline-stub" />',
        },
      },
    },
  });
  mountedViews.push(wrapper);
  await flushPromises();
  const state = useSessionStore(pinia).stateFor(SESSION_ID);
  const stream = streamEvents({ sessionId: SESSION_ID, messageId: MESSAGE_ID });
  const rows = () => wrapper.findAll('[data-slot="row-stub"]');
  return { counter, events, rows, state, stream, wrapper };
}

type View = Awaited<ReturnType<typeof mountView>>;

/**
 * Load history the way a long session accumulates it: the remainder first,
 * then full chunks, with a render between them so the window trims. Two
 * sizes that differ by a multiple of the chunk end with the same window.
 */
async function seedInChunks(view: View, total: number): Promise<void> {
  let loaded = 0;
  while (loaded < total) {
    const size = loaded === 0 ? total % SEED_CHUNK || SEED_CHUNK : SEED_CHUNK;
    view.state.messages = [
      ...view.state.messages,
      ...seedHistory(size, { start: loaded }),
    ];
    loaded += size;
    await flushPromises();
  }
}

async function startTurn(view: View): Promise<void> {
  view.events.emit(view.stream.running());
  for (const event of view.stream.userMessage("live-user", "Go on."))
    view.events.emit(event);
  view.events.emit(view.stream.messageStart());
  await flushPromises();
}

async function streamFlushes(view: View, count: number, from = 0) {
  for (let flush = from; flush < from + count; flush++) {
    view.events.emit(
      flush < FLUSHES / 2
        ? view.stream.thinkingDelta(`Thought ${flush}. `, 0)
        : view.stream.textDelta(`Sentence ${flush}. `, 1),
    );
    await flushPromises();
  }
}

interface StreamMetrics {
  mountedRows: number;
  readsPerFlush: number;
  rowRendersPerFlush: number;
  viewUpdatesPerFlush: number;
  mutationsOutsideStreamingRow: number;
}

async function measureStream(history: number): Promise<StreamMetrics> {
  const view = await mountView();
  await seedInChunks(view, history);
  await startTurn(view);
  const mutations = mutationCounter(view.wrapper.element);
  const streamingRow = view.rows().at(-1)?.element ?? null;

  resetHistoryReads();
  rowRenders = 0;
  view.counter.reset();
  await streamFlushes(view, FLUSHES);

  const metrics: StreamMetrics = {
    mountedRows: view.rows().length,
    readsPerFlush: historyReads() / FLUSHES,
    rowRendersPerFlush: rowRenders / FLUSHES,
    viewUpdatesPerFlush: view.counter.updates("ProjectSessionView") / FLUSHES,
    mutationsOutsideStreamingRow: mutations.outside(streamingRow),
  };
  // The stream reached the screen.
  expect(view.state.messages).toHaveLength(history + 2);
  expect(view.rows().at(-1)?.text()).not.toBe("0");
  mutations.disconnect();
  view.wrapper.unmount();
  reportMetrics(`stream into N=${history}`, { ...metrics });
  return metrics;
}

let measured: Promise<[StreamMetrics, StreamMetrics]> | undefined;

/** Each size is streamed once, one after the other, and shared by the tests. */
function streamMetrics(): Promise<[StreamMetrics, StreamMetrics]> {
  measured ??= (async () => {
    const short = await measureStream(HISTORY_SIZES[0]);
    const long = await measureStream(HISTORY_SIZES[1]);
    return [short, long];
  })();
  return measured;
}

describe("ProjectSessionView streaming cost", () => {
  it("[V1] reads the same number of history messages per flush at any length", async () => {
    const [short, long] = await streamMetrics();
    expect(long.readsPerFlush).toBe(short.readsPerFlush);
    expect(long.readsPerFlush).toBeLessThanOrEqual(4 * long.mountedRows);
  });

  it("[V2] renders exactly one row per flush", async () => {
    const [short, long] = await streamMetrics();
    expect(short.rowRendersPerFlush).toBe(1);
    expect(long.rowRendersPerFlush).toBe(1);
    expect(short.mutationsOutsideStreamingRow).toBe(0);
    expect(long.mutationsOutsideStreamingRow).toBe(0);
  });

  it("[V3] keeps at most a window of rows mounted while following", async () => {
    const [short, long] = await streamMetrics();
    expect(short.mountedRows).toBeLessThanOrEqual(RENDER_WINDOW_MAX);
    expect(long.mountedRows).toBe(short.mountedRows);
  });

  it("[V4] trims the window when the reader returns to the live end", async () => {
    const view = await mountView();
    await seedInChunks(view, HISTORY_SIZES[0]);
    await startTurn(view);
    const following = view.rows().length;

    followingBottom.value = false;
    view.state.messages = [
      ...view.state.messages,
      ...seedHistory(100, { prefix: "later" }),
    ];
    await flushPromises();
    const away = view.rows().length;
    // A reader away from the live end keeps what they have revealed.
    expect(away).toBe(following + 100);

    followingBottom.value = true;
    await flushPromises();
    reportMetrics("V4 follow again without an append", {
      rowsWhileFollowing: following,
      rowsWhileAway: away,
      rowsAfterFollowingAgain: view.rows().length,
    });
    expect(view.rows().length).toBeLessThanOrEqual(RENDER_WINDOW_MAX);
  });

  it("[V5] renders nothing while the document is hidden and catches up after", async () => {
    const view = await mountView();
    await seedInChunks(view, HISTORY_SIZES[0]);
    await startTurn(view);
    await streamFlushes(view, 5);

    setDocumentVisibility("hidden");
    await flushPromises();
    rowRenders = 0;
    await streamFlushes(view, 10, 5);
    const hiddenRenders = rowRenders;
    const shownWhileHidden = view.rows().at(-1)?.text();

    setDocumentVisibility("visible");
    await flushPromises();
    reportMetrics("V5 hidden document", {
      rowRendersPerFlushWhileHidden: hiddenRenders / 10,
      rowRendersOnReturn: rowRenders - hiddenRenders,
    });
    expect(hiddenRenders).toBe(0);
    // One render brings the row up to date.
    expect(view.rows().at(-1)?.text()).not.toBe(shownWhileHidden);
    expect(
      view.wrapper
        .findAllComponents({ name: "ProjectTranscriptMessage" })
        .at(-1)
        ?.props("message"),
    ).toBe(view.state.messages.at(-1));
  });

  it("[V6] leaves no timer running once the reply has ended", async () => {
    const clock = frameClock();
    const view = await mountView();
    await seedInChunks(view, HISTORY_SIZES[0]);
    await startTurn(view);
    await streamFlushes(view, FLUSHES);
    const whileStreaming = clock.pendingTimers();

    view.events.emit(
      view.stream.messageEnd([
        { type: "thinking", thinking: "Done thinking." },
        { type: "text", text: "Done." },
      ]),
    );
    view.events.emit(view.stream.idle());
    await clock.advance(2_000);

    reportMetrics("V6 timers", {
      pendingWhileStreaming: whileStreaming,
      pendingTwoSecondsAfterIdle: clock.pendingTimers(),
      pendingFramesTwoSecondsAfterIdle: clock.pendingFrames(),
    });
    expect(view.state.isRunning).toBe(false);
    expect(clock.pendingTimers()).toBe(0);
  });

  it("[V7] does not re-render the view itself on a flush", async () => {
    const [short, long] = await streamMetrics();
    expect(short.viewUpdatesPerFlush).toBe(0);
    expect(long.viewUpdatesPerFlush).toBe(0);
  });
});
