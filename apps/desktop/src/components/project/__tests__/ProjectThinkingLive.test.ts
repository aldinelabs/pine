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
  it("shows only the current block and fades the previous one out", async () => {
    const live = mountLive("A");
    await live.set("A\n\nB");
    expect(live.current()).toHaveLength(1);
    expect(live.current()[0].text()).toBe("B");
    const [leaving] = live.leaving();
    expect(leaving.text()).toBe("A");
    expect(leaving.attributes("aria-hidden")).toBe("true");

    await leaving.trigger("animationend");
    expect(live.leaving()).toHaveLength(0);
    expect(live.items()).toHaveLength(1);
  });

  it("patches the same block element while it grows", async () => {
    const live = mountLive("Weigh the");
    const element = live.current()[0].element;
    await live.set("Weigh the options.");
    await live.set("Weigh the options.\nThen pick one.");
    expect(live.current()[0].element).toBe(element);
    expect(live.leaving()).toHaveLength(0);
    expect(live.current()[0].text()).toContain("Then pick one.");
  });

  it("renders the first block without an enter animation", async () => {
    const live = mountLive("First.");
    expect(live.current()[0].attributes("data-initial")).toBe("true");
    await live.set("First.\n\nSecond.");
    expect(live.current()[0].attributes("data-initial")).toBeUndefined();
  });

  it("treats a new thinking segment as a new block", async () => {
    const live = mountLive("First summary");
    await live.set("Second summary", 1);
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
    expect(live.current()[0].text()).toBe("Step 8.");
    expect(live.leaving()[0].text()).toBe("Step 7.");
  });

  it("never shrinks and caps a tall block at the panel height", async () => {
    const observers = resizeObserverStub();
    cleanups.push(() => observers.restore());
    const live = mountLive("Short.");
    const stack = live.wrapper.get(".grid").element;
    let stackHeight = 120;
    stubHeight(stack, () => stackHeight);
    const root = live.wrapper.get<HTMLElement>("[data-thinking-live]");

    observers.fire((target) => target === stack);
    await nextTick();
    expect(root.element.style.minHeight).toBe("120px");

    stackHeight = 40;
    await live.set("Short.\n\nShorter.");
    observers.fire((target) => target === stack);
    await nextTick();
    expect(root.element.style.minHeight).toBe("120px");
    expect(root.attributes("data-scrollable")).toBeUndefined();

    stackHeight = 400;
    await live.set("Short.\n\nShorter.\nNow very long.");
    for (const item of live.current()) stubHeight(item.element, () => 400);
    observers.fire();
    await nextTick();
    expect(root.element.style.minHeight).toBe("256px");
    expect(root.attributes("data-scrollable")).toBe("start");
    expect(live.current()[0].attributes("data-tall")).toBe("true");
  });

  it("swaps with CSS only: no timer or frame, and no fade under reduced motion", async () => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "setInterval",
        "requestAnimationFrame",
        "requestIdleCallback",
      ],
    });
    const live = mountLive("One.", 0, { stubMarkdown: true });
    expect(vi.getTimerCount()).toBe(0);
    await live.set("One.\n\nTwo.");
    await live.set("One.\n\nTwo.\n\nThree.");
    expect(live.leaving()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);

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
  });
});
