/*
 * BASELINE: measured on the renderer before any perf change. The real
 * `MarkdownContent` and markstream run on a fake clock. The source holds six
 * citations, one image and six finished tables; then 30 flushes, 120 ms
 * apart, each append one sentence to the last paragraph with `final` false.
 *
 * | id | metric (per flush unless noted)                           | before        | after W2-B    | target      |
 * | -- | --------------------------------------------------------- | ------------- | ------------- | ----------- |
 * | K1 | component updates inside the six finished tables          | 324           | 0             | 0           |
 * | K2 | component updates below the six citation chips            | 18            | 0             | 0           |
 * | K3 | component updates below the image                         | 1             | 0             | 0           |
 * | K4 | fade spans after a flush, compact (thinking) renderer     | 4             | 4             | 0           |
 * | K6 | characters re-parsed on the last flush / source length    | 2,254 / 2,254 | 2,254 / 2,254 | O(appended) |
 * | -  | own re-runs of MarkdownTable / citation chip / image      | 6 / 6 / 1     | 6 / 6 / 1     | -           |
 * | -  | component updates of any kind                             | 399           | 56            | -           |
 * | D1 | AlertDialog instances mounted by a never-clicked renderer | 1             | 1             | 0           |
 * | D1 | component instances of that closed dialog tree            | 6             | 6             | 0           |
 *
 * Holds after W2-B: K1, K2, K3. Not met yet (`it.fails`): K4 (the streaming
 * fade of thinking text stays as it is by user decision), D1 (wave 4). K6 is
 * an `it.todo`: nothing planned makes parsing incremental, the row records
 * what a flush costs today. When a change makes a target hold, turn it into
 * `it` and update the measured column.
 *
 * K2 and K3 count what re-renders below the custom component, not the
 * component itself. markstream hands `MarkdownCitationReference`,
 * `MarkdownImage` and `MarkdownTable` a new `node` object on every parse, so
 * their own render re-runs on every flush whatever they do; what a fix can
 * settle is everything they render. (Checked by sharing the citation objects
 * between parses: the chips' children drop to 0 updates, the chip stays at 6.)
 *
 * Print the metrics with `PINE_PERF_LOG=1` (add `--reporter=default` when
 * vitest hides the output of passing tests).
 */
import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  componentCounter,
  frameClock,
  markdownParses,
  reportMetrics,
} from "@/__tests__/perf/streamHarness";
import { createAppI18n } from "@/app/i18n";
import MarkdownContent from "../MarkdownContent.vue";

vi.mock("@/components/markdown/configureMarkdown", async (original) => {
  const actual =
    await original<typeof import("@/components/markdown/configureMarkdown")>();
  const { countMarkdownParses } =
    await import("@/__tests__/perf/streamHarness");
  return {
    ...actual,
    configurePineMarkdown: countMarkdownParses(actual.configurePineMarkdown),
  };
});

const FLUSHES = 30;
const FLUSH_INTERVAL_MS = 120;
const TABLES = 6;
const CITATIONS = 6;

function table(index: number): string {
  return [
    `Table ${index} compares two options.`,
    "",
    `| Option ${index} | Cost | Notes |`,
    "| --- | ---: | --- |",
    `| Keep ${index} | 1 | **stable** |`,
    `| Replace ${index} | 2 | needs a \`migration\` |`,
  ].join("\n");
}

const settledSource = [
  `The sources agree${Array.from({ length: CITATIONS }, (_, index) => `[^${index + 1}]`).join("")}.`,
  "![Overview](https://example.com/overview.png)",
  ...Array.from({ length: TABLES }, (_, index) => table(index + 1)),
  Array.from(
    { length: CITATIONS },
    (_, index) =>
      `[^${index + 1}]: [Source ${index + 1}](https://source${index + 1}.example.com/page)`,
  ).join("\n"),
  "In summary:",
].join("\n\n");

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function mountMarkdown(props: {
  source: string;
  final: boolean;
  compact?: boolean;
}) {
  const clock = frameClock();
  const pinia = createPinia();
  setActivePinia(pinia);
  const counter = componentCounter();
  const wrapper: VueWrapper = mount(MarkdownContent, {
    props,
    attachTo: document.body,
    global: {
      plugins: [pinia, createAppI18n("en-US")],
      mixins: [counter.mixin],
    },
  });
  cleanups.push(
    () => clock.restore(),
    () => wrapper.unmount(),
  );
  return { clock, counter, wrapper };
}

interface AppendMetrics {
  updatesInsideTables: number;
  updatesBelowCitations: number;
  updatesBelowImage: number;
  ownUpdates: { table: number; citation: number; image: number };
  componentUpdates: number;
  reparsedCharactersLastFlush: number;
  sourceLengthLastFlush: number;
  streamParsesLastFlush: number;
}

/** Stream 30 sentences onto the end of a block full of settled content. */
async function measureAppends(): Promise<AppendMetrics> {
  const { clock, counter, wrapper } = mountMarkdown({
    source: settledSource,
    final: false,
  });
  await clock.advance(FLUSH_INTERVAL_MS);
  expect(wrapper.findAll('[data-slot="markdown-table"]')).toHaveLength(TABLES);
  expect(wrapper.findAll('[data-slot="inline-citation"]')).toHaveLength(
    CITATIONS,
  );
  expect(counter.mountedCount("MarkdownImage")).toBe(1);

  const parses = markdownParses();
  counter.reset();
  let source = settledSource;
  let reparsedCharactersLastFlush = 0;
  let streamParsesLastFlush = 0;
  for (let flush = 0; flush < FLUSHES; flush++) {
    source += ` Sentence ${flush + 1} adds a little more.`;
    parses.reset();
    await wrapper.setProps({ source });
    await clock.advance(FLUSH_INTERVAL_MS);
    reparsedCharactersLastFlush = parses.fullCharacters();
    streamParsesLastFlush = parses.streamParses();
  }

  const updates = counter.updateTable();
  const metrics: AppendMetrics = {
    updatesInsideTables:
      counter.updatesInside('[data-slot="markdown-table"]') / FLUSHES,
    updatesBelowCitations:
      counter.updatesUnder("MarkdownCitationReference") / FLUSHES,
    updatesBelowImage: counter.updatesUnder("MarkdownImage") / FLUSHES,
    ownUpdates: {
      table: counter.updates("MarkdownTable") / FLUSHES,
      citation: counter.updates("MarkdownCitationReference") / FLUSHES,
      image: counter.updates("MarkdownImage") / FLUSHES,
    },
    componentUpdates:
      Object.values(updates).reduce((total, count) => total + count, 0) /
      FLUSHES,
    reparsedCharactersLastFlush,
    sourceLengthLastFlush: source.length,
    streamParsesLastFlush,
  };
  // Every flush reached the screen and the settled content is still there.
  expect(wrapper.text()).toContain(`Sentence ${FLUSHES} adds a little more.`);
  expect(wrapper.findAll('[data-slot="markdown-table"]')).toHaveLength(TABLES);
  expect(wrapper.findAll('[data-slot="inline-citation"]')).toHaveLength(
    CITATIONS,
  );
  const { ownUpdates, ...counts } = metrics;
  reportMetrics("markdown tail appends", counts);
  reportMetrics("markdown custom components, own re-runs", ownUpdates);
  reportMetrics("markdown component updates", updates);
  return metrics;
}

let measured: Promise<AppendMetrics> | undefined;

/** The appends run once and are shared by the tests. */
function appendMetrics(): Promise<AppendMetrics> {
  measured ??= measureAppends();
  return measured;
}

describe("MarkdownContent streaming cost", () => {
  it("[K1] updates nothing inside a finished table", async () => {
    const metrics = await appendMetrics();
    expect(metrics.updatesInsideTables).toBe(0);
  });

  it("[K2] updates nothing below a citation chip", async () => {
    const metrics = await appendMetrics();
    expect(metrics.updatesBelowCitations).toBe(0);
  });

  it("[K3] updates nothing below a finished image", async () => {
    const metrics = await appendMetrics();
    expect(metrics.updatesBelowImage).toBe(0);
  });

  it.fails("[K4] adds no fade span to the compact renderer", async () => {
    const { clock, wrapper } = mountMarkdown({
      source: "Weighing the options.",
      final: false,
      compact: true,
    });
    await clock.advance(FLUSH_INTERVAL_MS);
    let source = "Weighing the options.";
    let fadeSpans = 0;
    for (let flush = 0; flush < 5; flush++) {
      source += ` Thought ${flush + 1}.`;
      await wrapper.setProps({ source });
      fadeSpans = Math.max(
        fadeSpans,
        wrapper.findAll(".text-node-stream-delta").length,
      );
      await clock.advance(FLUSH_INTERVAL_MS);
    }
    reportMetrics("K4 compact renderer", { fadeSpansAfterFlush: fadeSpans });
    expect(wrapper.text()).toContain("Thought 5.");
    expect(fadeSpans).toBe(0);
  });

  it.todo("[K6] parses only the appended text on a flush");

  it.fails("[D1] mounts no link dialog until a link is clicked", () => {
    const { counter } = mountMarkdown({
      source: "See [the docs](https://example.com/docs).",
      final: true,
    });
    const mounted = counter.mountedTable();
    const dialogInstances = Object.entries(mounted)
      .filter(([name]) => /Dialog|Teleport|Presence|FocusScope/u.test(name))
      .reduce((total, [, count]) => total + count, 0);
    reportMetrics("D1 closed link dialog", {
      alertDialogInstances: counter.mountedCount("AlertDialog"),
      dialogTreeInstances: dialogInstances,
    });
    reportMetrics("D1 mounted components", mounted);
    expect(counter.mountedCount("AlertDialog")).toBe(0);
  });
});
