import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { COMPOSER_GLOW_FADE_OUT_MS } from "@/lib/composerGlow";
import ProjectComposerGlow from "../ProjectComposerGlow.vue";

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((media: string) => ({
      matches: media.includes("prefers-reduced-motion") && reduce,
      media,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

const GLOW = '[data-slot="session-composer-glow"]';

function mountGlow(active: boolean) {
  return mount(ProjectComposerGlow, { props: { active } });
}

describe("ProjectComposerGlow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setReducedMotion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders nothing while inactive", () => {
    const wrapper = mountGlow(false);
    expect(wrapper.find(GLOW).exists()).toBe(false);
  });

  it("orbits two beams around the outline while active", () => {
    const wrapper = mountGlow(true);
    const glow = wrapper.get(GLOW);
    expect(glow.attributes("data-state")).toBe("on");
    expect(glow.attributes("data-motion")).toBe("full");
    expect(glow.attributes("aria-hidden")).toBe("true");
    expect(glow.findAll(".composer-glow-beam")).toHaveLength(2);
    expect(
      (glow.element as HTMLElement).style.getPropertyValue(
        "--composer-glow-spin-a",
      ),
    ).toMatch(/s$/);
  });

  it("fades out, then unmounts", async () => {
    const wrapper = mountGlow(true);
    await wrapper.setProps({ active: false });
    expect(wrapper.get(GLOW).attributes("data-state")).toBe("leaving");
    vi.advanceTimersByTime(COMPOSER_GLOW_FADE_OUT_MS - 1);
    await nextTick();
    expect(wrapper.find(GLOW).exists()).toBe(true);
    vi.advanceTimersByTime(1);
    await nextTick();
    expect(wrapper.find(GLOW).exists()).toBe(false);
  });

  it("resumes without remounting when work restarts during the fade", async () => {
    const wrapper = mountGlow(true);
    const element = wrapper.get(GLOW).element as HTMLElement;
    const spin = element.style.getPropertyValue("--composer-glow-spin-a");
    await wrapper.setProps({ active: false });
    vi.advanceTimersByTime(COMPOSER_GLOW_FADE_OUT_MS / 2);
    await wrapper.setProps({ active: true });
    vi.advanceTimersByTime(COMPOSER_GLOW_FADE_OUT_MS);
    await nextTick();
    const glow = wrapper.get(GLOW);
    expect(glow.element).toBe(element);
    expect(glow.attributes("data-state")).toBe("on");
    expect(element.style.getPropertyValue("--composer-glow-spin-a")).toBe(spin);
  });

  it("starts a new run at a new phase", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.2);
    const wrapper = mountGlow(true);
    const before = (wrapper.get(GLOW).element as HTMLElement).getAttribute(
      "style",
    );
    await wrapper.setProps({ active: false });
    vi.advanceTimersByTime(COMPOSER_GLOW_FADE_OUT_MS);
    await nextTick();
    random.mockReturnValue(0.7);
    await wrapper.setProps({ active: true });
    const after = (wrapper.get(GLOW).element as HTMLElement).getAttribute(
      "style",
    );
    expect(after).not.toBe(before);
  });

  it("keeps a still rim without beams under reduced motion", () => {
    setReducedMotion(true);
    const wrapper = mountGlow(true);
    const glow = wrapper.get(GLOW);
    expect(glow.attributes("data-motion")).toBe("reduced");
    expect(glow.find(".composer-glow-base").exists()).toBe(true);
    expect(glow.find(".composer-glow-beam").exists()).toBe(false);
  });

  it("clears the fade-out timer when unmounted mid-fade", async () => {
    const wrapper = mountGlow(true);
    await wrapper.setProps({ active: false });
    expect(vi.getTimerCount()).toBe(1);
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
