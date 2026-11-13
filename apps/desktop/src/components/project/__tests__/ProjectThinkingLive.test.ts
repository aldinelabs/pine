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

function mountLive(
  text: string,
  segment = 0,
  options: { stubMarkdown?: boolean } = {},
) {
  const wrapper = mount(ProjectThinkingLive, {
    props: { source: { segment, text } },
    attachTo: document.body,
    global: {
      plugins: [createPinia(), createAppI18n("en-US")],
      stubs: options.stubMarkdown ? { MarkdownContent: MarkdownStub } : {},
    },
  });
  cleanups.push(() => wrapper.unmount());
  return {
    wrapper,
    set: (next: string, nextSegment = segment) =>
      wrapper.setProps({ source: { segment: nextSegment, text: next } }),
    items: () => wrapper.findAll(".thinking-live-block"),
    current: () => wrapper.findAll(".thinking-live-block:not([data-leaving])"),
    leaving: () => wrapper.findAll(".thinking-live-block[data-leaving]"),
  };
}

function stubHeight(element: Element, height: () => number): void {
  element.getBoundingClientRect = () =>
    ({ height: height(), width: 300 }) as DOMRect;
}

describe("ProjectThinkingLive", () => {
  it("holds a one-line skeleton until the first block is complete", async () => {
    const live = mountLive("Weigh the", 0, { stubMarkdown: true });
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
    expect(live.current()).toHaveLength(1);
    expect(live.current()[0].text()).toBe("Weigh the options.\nThen pick one.");
    // It follows the skeleton, so it fades in.
    expect(live.current()[0].attributes("data-initial")).toBeUndefined();
    expect(live.leaving()).toHaveLength(0);
  });

  it("shows only whole blocks and fades the previous one out", async () => {
    const live = mountLive("A\n\nB");
    expect(live.current()[0].text()).toBe("A");
    await live.set("A\n\nB grows");
    expect(live.current()[0].text()).toBe("A");
    await live.set("A\n\nB grows\n\nC");
    expect(live.current()).toHaveLength(1);
    expect(live.current()[0].text()).toBe("B grows");
    const [leaving] = live.leaving();
    expect(leaving.text()).toBe("A");
    expect(leaving.attributes("aria-hidden")).toBe("true");

    await leaving.trigger("animationend");
    expect(live.leaving()).toHaveLength(0);
    expect(live.items()).toHaveLength(1);
  });

  it("renders a block complete at mount without an enter animation", async () => {
    const live = mountLive("First.\n\nSecond.");
    expect(live.current()[0].text()).toBe("First.");
    expect(live.current()[0].attributes("data-initial")).toBe("true");
    await live.set("First.\n\nSecond.\n\nThird.");
    expect(live.current()[0].attributes("data-initial")).toBeUndefined();
  });

  it("completes a segment's last block when a new segment starts", async () => {
    const live = mountLive("First summary");
    expect(live.items()).toHaveLength(0);
    await live.set("Second summary", 1);
    expect(live.current()[0].text()).toBe("First summary");
    await live.set("Second summary\n\nMore", 1);
    expect(live.current()[0].text()).toBe("Second summary");
    expect(live.leaving()[0].text()).toBe("First summary");
  });

  it("keeps at most the current and one leaving block", async () => {
    const live = mountLive("Step 1.");
    let text = "Step 1.";
    for (let step = 2; step <= 8; step++) {
      text += `\n\nStep ${step}.`;
      await live.set(text);
    }
    expect(live.items()).toHaveLength(2);
    expect(live.current()[0].text()).toBe("Step 7.");
    expect(live.leaving()[0].text()).toBe("Step 6.");
  });

  it("shows a long unfinished block in coarse steps, then its whole text in place", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const long = "word ".repeat(130);
    const live = mountLive(long, 0, { stubMarkdown: true });
    expect(live.current()[0].text()).toBe(long.trim());
    expect(live.current()[0].attributes("data-initial")).toBe("true");
    const element = live.current()[0].element;

    // Tokens within the refresh interval leave the shown text alone.
    await live.set(`${long}more`);
    await live.set(`${long}more words`);
    expect(live.current()[0].text()).toBe(long.trim());

    await vi.advanceTimersByTimeAsync(1500);
    expect(live.current()[0].text()).toBe(`${long}more words`);

    await live.set(`${long}more words end.\n\nNext`);
    expect(live.current()).toHaveLength(1);
    expect(live.current()[0].element).toBe(element);
    expect(live.current()[0].text()).toBe(`${long}more words end.`);
    expect(live.leaving()).toHaveLength(0);
  });

  it("shows an unfinished block after a few seconds without a complete one", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const live = mountLive("Still weighing", 0, { stubMarkdown: true });
    expect(live.items()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(3999);
    expect(live.items()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(live.current()[0].text()).toBe("Still weighing");
    // Nothing new arrived: no further timer keeps running.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never shrinks and caps a tall block at the panel height", async () => {
    const observers = resizeObserverStub();
    cleanups.push(() => observers.restore());
    const live = mountLive("Short.\n\nx");
    const stack = live.wrapper.get(".grid").element;
    let stackHeight = 120;
    stubHeight(stack, () => stackHeight);
    const root = live.wrapper.get<HTMLElement>("[data-thinking-live]");

    observers.fire((target) => target === stack);
    await nextTick();
    expect(root.element.style.minHeight).toBe("120px");

    stackHeight = 40;
    await live.set("Short.\n\nShorter.\n\nx");
    observers.fire((target) => target === stack);
    await nextTick();
    expect(root.element.style.minHeight).toBe("120px");
    expect(root.attributes("data-scrollable")).toBeUndefined();

    stackHeight = 400;
    await live.set("Short.\n\nShorter.\n\nNow very long.\n\nx");
    for (const item of live.current()) stubHeight(item.element, () => 400);
    observers.fire();
    await nextTick();
    expect(root.element.style.minHeight).toBe("256px");
    expect(root.attributes("data-scrollable")).toBe("start");
    expect(live.current()[0].attributes("data-tall")).toBe("true");
  });

  it("keeps a tall outgoing block pinned at its tail while it fades", async () => {
    const observers = resizeObserverStub();
    cleanups.push(() => observers.restore());
    const live = mountLive("Long paragraph.\n\nx");
    const stack = live.wrapper.get(".grid").element;
    stubHeight(stack, () => 400);
    const root = live.wrapper.get<HTMLElement>("[data-thinking-live]");
    for (const item of live.current()) stubHeight(item.element, () => 400);
    observers.fire();
    await nextTick();
    expect(root.classes()).toContain("justify-end");

    await live.set("Long paragraph.\n\nShort.\n\nx");
    const [leaving] = live.leaving();
    expect(leaving.attributes("data-tall")).toBe("true");
    expect(live.current()[0].attributes("data-tall")).toBeUndefined();
    // The new short block aligns to the top; the fading tail keeps its mask.
    expect(root.classes()).not.toContain("justify-end");
    expect(root.attributes("data-scrollable")).toBe("start");
    expect(root.classes()).toContain("relative");

    const source = readFileSync(
      path.resolve(__dirname, "../ProjectThinkingLive.vue"),
      "utf8",
    );
    // The leaving tall block is taken out of the grid, so it no longer sizes it.
    expect(source).toMatch(
      /\.thinking-live-block\[data-leaving\]\[data-tall\]\s*\{\s*position:\s*absolute;[^}]*bottom:\s*0;/,
    );

    await leaving.trigger("animationend");
    expect(root.attributes("data-scrollable")).toBeUndefined();
  });

  it("swaps with CSS only: one recheck timer at most, no frame, and no fade under reduced motion", async () => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "requestAnimationFrame",
        "requestIdleCallback",
      ],
    });
    const live = mountLive("One.", 0, { stubMarkdown: true });
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
    expect(live.leaving()).toHaveLength(1);

    const source = readFileSync(
      path.resolve(__dirname, "../ProjectThinkingLive.vue"),
      "utf8",
    );
    const reduced = source.slice(
      source.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reduced).toMatch(/\.thinking-live-block\s*\{\s*animation:\s*none;/);
    expect(reduced).toMatch(
      /\.thinking-live-block\[data-leaving\]\s*\{\s*display:\s*none;/,
    );
    expect(source).toMatch(/<Skeleton[^>]*motion-reduce:animate-none/);
  });
});
