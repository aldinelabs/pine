import { readFileSync } from "node:fs";
import path from "node:path";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPinia } from "pinia";
import { nextTick } from "vue";
import { createAppI18n } from "@/app/i18n";
import { resizeObserverStub } from "@/__tests__/perf/streamHarness";
import ProjectThinkingLive from "../ProjectThinkingLive.vue";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.useRealTimers();
});

/** Stands in for the markdown renderer, which has timers of its own. */
const MarkdownStub = {
  props: ["source", "final", "compact"],
  template: "<div>{{ source }}</div>",
};

type Source = { segment: number; text: string };

function mountLive(
  sources: Source[] | string,
  options: { stubMarkdown?: boolean } = {},
) {
  const initial =
    typeof sources === "string" ? [{ segment: 0, text: sources }] : sources;
  const wrapper = mount(ProjectThinkingLive, {
    props: { sources: initial },
    attachTo: document.body,
    global: {
      plugins: [createPinia(), createAppI18n("en-US")],
      stubs: options.stubMarkdown ? { MarkdownContent: MarkdownStub } : {},
    },
  });
  cleanups.push(() => wrapper.unmount());
  return {
    wrapper,
    set: (next: Source[] | string) =>
      wrapper.setProps({
        sources: typeof next === "string" ? [{ segment: 0, text: next }] : next,
      }),
    blocks: () =>
      wrapper.findAll(".thinking-live-block").map((item) => item.text()),
    items: () => wrapper.findAll(".thinking-live-block"),
  };
}

/** Gives the panel a scroll range and records where it is sent. */
function stubPanel(element: HTMLElement, clientHeight = 256) {
  let scrollHeight = clientHeight;
  let scrollTop = 0;
  const calls: ScrollToOptions[] = [];
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    get: () => clientHeight,
  });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  element.scrollTo = ((options: ScrollToOptions) => {
    calls.push(options);
    scrollTop = options.top ?? scrollTop;
  }) as typeof element.scrollTo;
  return {
    calls,
    grow: (height: number) => {
      scrollHeight = height;
    },
    userScrollTo: async (top: number) => {
      element.dispatchEvent(new Event("wheel"));
      scrollTop = top;
      element.dispatchEvent(new Event("scroll"));
      await nextTick();
    },
  };
}

describe("ProjectThinkingLive", () => {
  it("holds a one-line skeleton until the first block is complete", async () => {
    const live = mountLive("Weigh the", { stubMarkdown: true });
    expect(live.items()).toHaveLength(0);
    expect(live.wrapper.find("[data-thinking-placeholder]").exists()).toBe(
      true,
    );
    expect(live.wrapper.text()).toBe("");

    await live.set("Weigh the options.\nThen pick one.");
    expect(live.items()).toHaveLength(0);

    await live.set("Weigh the options.\nThen pick one.\n\nNext");
    expect(live.wrapper.find("[data-thinking-placeholder]").exists()).toBe(
      false,
    );
    expect(live.blocks()).toEqual(["Weigh the options.\nThen pick one."]);
    // It follows the skeleton, so it fades in.
    expect(live.items()[0].attributes("data-initial")).toBeUndefined();
  });

  it("appends whole blocks only, keeping the earlier ones", async () => {
    const live = mountLive("A\n\nB");
    expect(live.blocks()).toEqual(["A"]);
    await live.set("A\n\nB grows");
    expect(live.blocks()).toEqual(["A"]);
    await live.set("A\n\nB grows\n\nC");
    expect(live.blocks()).toEqual(["A", "B grows"]);
    const [first, second] = live.items();
    expect(first.attributes("data-initial")).toBe("true");
    expect(second.attributes("data-initial")).toBeUndefined();
  });

  it("completes a segment's last block when a new segment starts", async () => {
    const live = mountLive("First summary");
    expect(live.items()).toHaveLength(0);
    const first = { segment: 0, text: "First summary" };
    await live.set([first, { segment: 2, text: "Second summary" }]);
    expect(live.blocks()).toEqual(["First summary"]);
    await live.set([first, { segment: 2, text: "Second summary\n\nMore" }]);
    expect(live.blocks()).toEqual(["First summary", "Second summary"]);
  });

  it("shows earlier segments in full when it mounts mid-stream", () => {
    const live = mountLive(
      [
        { segment: 0, text: "Earlier one.\n\nEarlier two." },
        { segment: 1, text: "Now.\n\nWrit" },
      ],
      { stubMarkdown: true },
    );
    expect(live.blocks()).toEqual(["Earlier one.\n\nEarlier two.", "Now."]);
  });

  it("shows a long unfinished block in coarse steps, then its whole text in place", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const long = "word ".repeat(130);
    const live = mountLive(long, { stubMarkdown: true });
    expect(live.blocks()).toEqual([long.trim()]);
    const element = live.items()[0].element;

    // Tokens within the refresh interval leave the shown text alone.
    await live.set(`${long}more`);
    await live.set(`${long}more words`);
    expect(live.blocks()).toEqual([long.trim()]);

    await vi.advanceTimersByTimeAsync(1500);
    expect(live.blocks()).toEqual([`${long}more words`]);

    await live.set(`${long}more words end.\n\nNext`);
    expect(live.items()).toHaveLength(1);
    expect(live.items()[0].element).toBe(element);
    expect(live.blocks()).toEqual([`${long}more words end.`]);
  });

  it("shows an unfinished block after a few seconds without a complete one", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const live = mountLive("Still weighing", { stubMarkdown: true });
    expect(live.items()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(3999);
    expect(live.items()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(live.blocks()).toEqual(["Still weighing"]);
    // Nothing new arrived: no further timer keeps running.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("glides to each new block with a smooth scroll, once per new bottom", async () => {
    const observers = resizeObserverStub();
    cleanups.push(() => observers.restore());
    const live = mountLive("One.\n\nx", { stubMarkdown: true });
    const root = live.wrapper.get<HTMLElement>("[data-thinking-live]");
    const panel = stubPanel(root.element);

    panel.grow(400);
    await live.set("One.\n\nTwo.\n\nx");
    observers.fire();
    expect(panel.calls).toEqual([{ top: 144, behavior: "smooth" }]);
    // A repeat report for the same bottom sends nothing.
    observers.fire();
    expect(panel.calls).toHaveLength(1);
    await nextTick();
    expect(root.attributes("data-scrollable")).toBe("start");

    panel.grow(500);
    observers.fire();
    expect(panel.calls.at(-1)).toEqual({ top: 244, behavior: "smooth" });
  });

  it("stops following when the reader scrolls up, and resumes at the bottom", async () => {
    const observers = resizeObserverStub();
    cleanups.push(() => observers.restore());
    const live = mountLive("One.\n\nx", { stubMarkdown: true });
    const root = live.wrapper.get<HTMLElement>("[data-thinking-live]");
    const panel = stubPanel(root.element);
    panel.grow(400);
    observers.fire();
    expect(panel.calls).toHaveLength(1);

    await panel.userScrollTo(20);
    expect(root.attributes("data-following")).toBeUndefined();
    expect(root.attributes("data-scrollable")).toBe("start end");
    panel.grow(600);
    observers.fire();
    expect(panel.calls).toHaveLength(1);

    // The glide's own scroll events never stop following.
    await panel.userScrollTo(344);
    expect(root.attributes("data-following")).toBe("true");
    panel.grow(700);
    observers.fire();
    expect(panel.calls.at(-1)).toEqual({ top: 444, behavior: "smooth" });
  });

  it("jumps instead of gliding under reduced motion", () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    cleanups.push(() => {
      window.matchMedia = matchMedia;
    });
    const observers = resizeObserverStub();
    cleanups.push(() => observers.restore());
    const live = mountLive("One.\n\nx", { stubMarkdown: true });
    const panel = stubPanel(
      live.wrapper.get<HTMLElement>("[data-thinking-live]").element,
    );
    panel.grow(400);
    observers.fire();
    expect(panel.calls).toEqual([{ top: 144, behavior: "auto" }]);
  });

  it("adds blocks with CSS only: one recheck timer at most, no frame, no fade under reduced motion", async () => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "requestAnimationFrame",
        "requestIdleCallback",
      ],
    });
    const live = mountLive("One.", { stubMarkdown: true });
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
    let text = "One.";
    for (const word of ["Two.", "Three.", "Four."]) {
      text += `\n\n${word}`;
      await live.set(text);
      for (const char of " and more") {
        text += char;
        await live.set(text);
        expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
      }
    }
    expect(live.items()).toHaveLength(3);

    const source = readFileSync(
      path.resolve(__dirname, "../ProjectThinkingLive.vue"),
      "utf8",
    );
    const reduced = source.slice(
      source.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reduced).toMatch(/\.thinking-live-block\s*\{\s*animation:\s*none;/);
    expect(source).toMatch(/<Skeleton[^>]*motion-reduce:animate-none/);
  });
});
