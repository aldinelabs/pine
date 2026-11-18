import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { galleryBlock } from "./fixtures/gallery";
import { mountBlock } from "./fixtures/mountBlock";

describe("input and interactive components", () => {
  beforeEach(() => {
    // Charts measure their container; jsdom has no layout.
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("draws every component of the gallery", async () => {
    const wrapper = await mountBlock(galleryBlock);
    await flushPromises();

    for (const name of [
      "row",
      "box",
      "spacer",
      "grid",
      "card",
      "accordion",
      "carousel",
      "popover",
      "heading",
      "text",
      "caption",
      "label",
      "list",
      "list-item",
      "link",
      "quote",
      "code",
      "math",
      "badge",
      "icon",
      "image",
      "button",
      "icon-button",
      "pressable",
      "form",
      "input",
      "select",
      "date-picker",
      "slider",
      "checkbox",
      "radio-group",
      "segmented-control",
      "timer",
      "table",
      "steps",
      "flashcard",
      "celebration",
    ]) {
      expect(wrapper.find(`[data-iui="${name}"]`).exists(), name).toBe(true);
    }
  });

  it("flips a Flashcard and runs a Pressable's action", async () => {
    const wrapper = await mountBlock(
      `root = Stack([Flashcard("Front", "Back"), Pressable([Text("Tile")], @Set($n, $n + 1)), Text("n=" + $n)])
$n = 0`,
    );
    await flushPromises();

    const card = wrapper.find('[data-iui="flashcard"]');
    expect(card.attributes("aria-pressed")).toBe("false");
    await card.trigger("click");
    expect(card.attributes("aria-pressed")).toBe("true");

    await wrapper.find('[data-iui="pressable"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("n=1");
  });

  it("counts a Timer down and resets it", async () => {
    vi.useFakeTimers();
    try {
      const wrapper = await mountBlock(
        `root = Stack([Timer($left, "Break"), Text($left == 0 ? "Over" : "Running")])
$left = 2`,
      );
      await flushPromises();
      expect(wrapper.text()).toContain("00:02");

      await wrapper.find('[aria-label="Start"]').trigger("click");
      await vi.advanceTimersByTimeAsync(2000);
      await flushPromises();
      expect(wrapper.text()).toContain("00:00");
      expect(wrapper.text()).toContain("Over");

      await wrapper.find('[aria-label="Reset"]').trigger("click");
      await flushPromises();
      expect(wrapper.text()).toContain("00:02");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows earlier Steps as done", async () => {
    const wrapper = await mountBlock(
      `root = Steps([Step("One"), Step("Two"), Step("Three")], 2)`,
    );
    await flushPromises();

    const items = wrapper.find('[data-iui="steps"]').element.children;
    const states = [...items]
      .filter((item) => item.hasAttribute("data-state"))
      .map((item) => item.getAttribute("data-state"));
    expect(states).toEqual(["completed", "active", "inactive"]);
  });
});
