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

  it("carries two lights round the outline while active", () => {
    const wrapper = mountGlow(true);
    const glow = wrapper.get(GLOW);
    expect(glow.attributes("data-state")).toBe("on");
    expect(glow.attributes("data-motion")).toBe("full");
    expect(glow.attributes("aria-hidden")).toBe("true");
    expect(glow.findAll(".composer-glow-orbit")).toHaveLength(2);
    expect(
      (glow.element as HTMLElement).style.getPropertyValue(
        "--composer-glow-breathe",
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
    const spin = element.style.getPropertyValue("--composer-glow-breathe");
    await wrapper.setProps({ active: false });
    vi.advanceTimersByTime(COMPOSER_GLOW_FADE_OUT_MS / 2);
    await wrapper.setProps({ active: true });
    vi.advanceTimersByTime(COMPOSER_GLOW_FADE_OUT_MS);
    await nextTick();
    const glow = wrapper.get(GLOW);
    expect(glow.element).toBe(element);
    expect(glow.attributes("data-state")).toBe("on");
    expect(element.style.getPropertyValue("--composer-glow-breathe")).toBe(
      spin,
    );
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
    expect(glow.find(".composer-glow-orbit").exists()).toBe(false);
  });

  it("clears the fade-out timer when unmounted mid-fade", async () => {
    const wrapper = mountGlow(true);
    await wrapper.setProps({ active: false });
    expect(vi.getTimerCount()).toBe(1);
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  describe("orbit animations", () => {
    let resize: (() => void) | undefined;
    let frames: FrameRequestCallback[];
    let animations: {
      element: Element;
      keyframes: Keyframe[];
      options: KeyframeAnimationOptions;
      setKeyframes: ReturnType<typeof vi.fn>;
      cancel: ReturnType<typeof vi.fn>;
    }[];
    let width: number;

    beforeEach(() => {
      resize = undefined;
      frames = [];
      animations = [];
      width = 736;
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(callback: () => void) {
            resize = callback;
          }
          observe() {}
          disconnect() {
            resize = undefined;
          }
        },
      );
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
        frames.push(callback),
      );
      vi.stubGlobal("cancelAnimationFrame", vi.fn());
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
        () => width,
      );
      vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(
        48,
      );
      const animate = function (
        this: Element,
        keyframes: Keyframe[],
        options: KeyframeAnimationOptions,
      ) {
        const record = {
          element: this,
          keyframes,
          options,
          setKeyframes: vi.fn(),
          cancel: vi.fn(),
        };
        animations.push(record);
        return {
          effect: { setKeyframes: record.setKeyframes },
          cancel: record.cancel,
        } as unknown as Animation;
      };
      Object.defineProperty(HTMLElement.prototype, "animate", {
        configurable: true,
        value: animate,
      });
    });

    afterEach(() => {
      delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
    });

    function flushFrames() {
      const pending = frames.splice(0);
      for (const callback of pending) callback(0);
    }

    it("lays out one lap per light by arc length, once per size", async () => {
      const wrapper = mountGlow(true);
      await nextTick();
      resize?.();
      resize?.();
      expect(frames).toHaveLength(1);
      flushFrames();
      expect(animations).toHaveLength(2);
      const [a, b] = animations;
      expect(a.options.iterations).toBe(Infinity);
      expect(a.options.direction).toBe("normal");
      expect(b.options.direction).toBe("reverse");
      expect(Number(a.options.delay)).toBeLessThanOrEqual(0);
      expect(a.keyframes.at(-1)!.offset).toBe(1);

      width = 400;
      resize?.();
      flushFrames();
      vi.runOnlyPendingTimers();
      expect(animations).toHaveLength(2);
      expect(a.setKeyframes).toHaveBeenCalledTimes(1);
      expect(a.setKeyframes.mock.calls[0][0]).not.toEqual(a.keyframes);
      wrapper.unmount();
    });

    it("re-paths the lights once a resize settles, not on every frame", async () => {
      const wrapper = mountGlow(true);
      await nextTick();
      resize?.();
      flushFrames();
      const [a, b] = animations;
      // An eased height transition reports a new size every frame.
      for (const next of [700, 680, 660, 640]) {
        width = next;
        resize?.();
        flushFrames();
        vi.advanceTimersByTime(16);
      }
      expect(a.setKeyframes).not.toHaveBeenCalled();
      expect(frames).toHaveLength(0);
      vi.runOnlyPendingTimers();
      expect(a.setKeyframes).toHaveBeenCalledTimes(1);
      expect(b.setKeyframes).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    });

    it("keeps the path when the size barely changes", async () => {
      const wrapper = mountGlow(true);
      await nextTick();
      resize?.();
      flushFrames();
      const [a] = animations;
      resize?.();
      vi.runOnlyPendingTimers();
      width = 736.4;
      resize?.();
      vi.runOnlyPendingTimers();
      expect(a.setKeyframes).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it("drops a pending re-path when the glow goes away", async () => {
      const wrapper = mountGlow(true);
      await nextTick();
      resize?.();
      flushFrames();
      width = 500;
      resize?.();
      const [a] = animations;
      wrapper.unmount();
      vi.runOnlyPendingTimers();
      expect(a.setKeyframes).not.toHaveBeenCalled();
      expect(a.cancel).toHaveBeenCalled();
    });

    it("stops the lights once the fade-out ends", async () => {
      const wrapper = mountGlow(true);
      await nextTick();
      resize?.();
      flushFrames();
      await wrapper.setProps({ active: false });
      vi.advanceTimersByTime(COMPOSER_GLOW_FADE_OUT_MS);
      await nextTick();
      expect(
        animations.every((record) => record.cancel.mock.calls.length),
      ).toBe(true);
      expect(resize).toBeUndefined();
      wrapper.unmount();
    });
  });
});
