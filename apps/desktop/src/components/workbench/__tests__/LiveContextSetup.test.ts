import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import LiveContextSetup from "@/components/workbench/LiveContextSetup.vue";

/**
 * jsdom has no layout, so the widths the row measures are set by hand: the
 * row is `rowWidth` wide, each control 40px, and Start's label 8px per
 * character.
 */
function stubLayout(rowWidth: number) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.dataset.testid === "live-context-setup" ? rowWidth : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const width =
        this.getAttribute("aria-hidden") === "true" && this.matches("span")
          ? (this.textContent?.length ?? 0) * 8
          : 40;
      return { width } as DOMRect;
    },
  );
}

function mountSetup(continues: boolean) {
  return mount(LiveContextSetup, {
    attachTo: document.body,
    props: {
      sources: ["mic", "system"],
      locale: "zh-CN",
      speakersAvailable: true,
      continues,
    },
    global: { plugins: [createAppI18n("en-US")] },
  });
}

describe("LiveContextSetup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("never truncates the language code", () => {
    const wrapper = mountSetup(false);
    const language = wrapper.get("[data-testid=live-context-language]");
    expect(language.text()).toBe("ZH (CN)");
    expect(language.classes()).not.toContain("truncate");
    expect(
      wrapper.get("[data-testid=live-context-options]").classes(),
    ).toContain("shrink-0");
  });

  it("drops Start to its icon when its label does not fit, keeping its name", async () => {
    // Sources, speakers and language: 3 × 40 (jsdom has no gap), leaving
    // 80 for "Start", 5 × 8 + 40 for its icon and padding.
    stubLayout(200);
    const wrapper = mountSetup(false);
    await wrapper.setProps({ locale: "en-US" });
    await flushPromises();
    const start = wrapper.get("[data-testid=live-context-start]");
    expect(start.attributes("data-compact")).toBeUndefined();
    expect(start.text()).toBe("Start");

    // "Continue" needs 8 × 8 + 40.
    await wrapper.setProps({ continues: true });
    await flushPromises();
    expect(start.attributes("data-compact")).toBe("true");
    expect(start.attributes("title")).toBe("Continue");
    // Still its accessible name, read from the visually hidden label.
    expect(start.get(".sr-only").text()).toBe("Continue");
  });
});
