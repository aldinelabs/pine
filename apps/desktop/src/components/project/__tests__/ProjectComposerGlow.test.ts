import { mount } from "@vue/test-utils";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  type MockInstance,
  vi,
} from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { COMPOSER_GLOW_FADE_OUT_MS } from "@/lib/composerGlow";
import type {
  ComposerGlowHostOptions,
  ComposerGlowUpdate,
} from "@/lib/composerGlowHost";
import type { ComposerGlowState } from "@/lib/composerGlow";
import ProjectComposerGlow from "../ProjectComposerGlow.vue";

interface FakeHost {
  canvas: HTMLCanvasElement;
  state: ComposerGlowState;
  options: ComposerGlowHostOptions;
  update: Mock<(changes: ComposerGlowUpdate) => void>;
  dispose: Mock<() => void>;
}

const hosts = vi.hoisted(() => [] as FakeHost[]);

vi.mock("@/lib/composerGlowHost", () => ({
  createComposerGlowHost: vi.fn(
    (
      canvas: HTMLCanvasElement,
      state: ComposerGlowState,
      options: ComposerGlowHostOptions,
    ) => {
      const host: FakeHost = {
        canvas,
        state,
        options,
        update: vi.fn(),
        dispose: vi.fn(),
      };
      hosts.push(host);
      return { mode: "worker", update: host.update, dispose: host.dispose };
    },
  ),
}));

let reduceMotion = false;
const mediaListeners = new Set<(event: { matches: boolean }) => void>();

function stubMatchMedia() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((media: string) => ({
      get matches() {
        return media.includes("prefers-reduced-motion") && reduceMotion;
      },
      media,
      onchange: null,
      addEventListener: vi.fn(
        (_type: string, listener: (event: { matches: boolean }) => void) =>
          mediaListeners.add(listener),
      ),
      removeEventListener: vi.fn(
        (_type: string, listener: (event: { matches: boolean }) => void) =>
          mediaListeners.delete(listener),
      ),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

const resizeObservers: { callback: () => void; disconnect: () => void }[] = [];
const mutationObservers: { callback: () => void; disconnect: () => void }[] =
  [];

class FakeResizeObserver {
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
  constructor(callback: () => void) {
    resizeObservers.push({ callback, disconnect: this.disconnect });
  }
}

class FakeMutationObserver {
  disconnect = vi.fn();
  observe = vi.fn();
  takeRecords = vi.fn(() => []);
  constructor(callback: () => void) {
    mutationObservers.push({ callback, disconnect: this.disconnect });
  }
}

const GLOW = '[data-slot="session-composer-glow"]';

/** The glow inside a stand-in for the composer's text box. */
function mountGlow(active: boolean) {
  const activeRef = ref(active);
  const Harness = defineComponent({
    setup: () => () =>
      h("div", { class: "control" }, [
        h(ProjectComposerGlow, { active: activeRef.value }),
      ]),
  });
  const wrapper = mount(Harness, { attachTo: document.body });
  const setActive = async (value: boolean) => {
    activeRef.value = value;
    await nextTick();
    await nextTick();
  };
  return { wrapper, setActive };
}

function controlRect(width: number, height: number) {
  return {
    x: 100,
    y: 300,
    left: 100,
    top: 300,
    right: 100 + width,
    bottom: 300 + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("ProjectComposerGlow", () => {
  let rectSpy: MockInstance<() => DOMRect>;
  let focusSpy: MockInstance<() => boolean>;

  beforeEach(() => {
    vi.useFakeTimers();
    hosts.length = 0;
    resizeObservers.length = 0;
    mutationObservers.length = 0;
    reduceMotion = false;
    mediaListeners.clear();
    stubMatchMedia();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
    focusSpy = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue(controlRect(700, 48));
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders nothing while inactive", () => {
    const { wrapper } = mountGlow(false);
    expect(wrapper.find(GLOW).exists()).toBe(false);
    expect(hosts).toHaveLength(0);
    wrapper.unmount();
  });

  it("starts one renderer on a canvas while active", async () => {
    const { wrapper } = mountGlow(true);
    await nextTick();
    const glow = wrapper.get(GLOW);
    expect(glow.attributes("data-state")).toBe("on");
    expect(glow.attributes("data-ready")).toBe("false");
    expect(glow.attributes("aria-hidden")).toBe("true");
    expect(glow.findAll("canvas")).toHaveLength(1);
    expect(hosts).toHaveLength(1);
    const { state, canvas } = hosts[0];
    expect(canvas).toBe(glow.get("canvas").element);
    expect(state.geometry.box.width).toBe(700);
    expect(state.geometry.box.height).toBe(48);
    expect(state.colors.tints).toHaveLength(3);
    expect(state.activity).toEqual({ focused: true, visible: true });
    expect(state.seed.waves).toHaveLength(3);
    expect(state.present).toBe(true);
    expect(state.reducedMotion).toBe(false);
    wrapper.unmount();
  });

  it("shows once the first frame is drawn", async () => {
    const { wrapper } = mountGlow(true);
    await nextTick();
    hosts[0].options.onFirstFrame();
    await nextTick();
    expect(wrapper.get(GLOW).attributes("data-ready")).toBe("true");
    wrapper.unmount();
  });

  it("fades out, then tears everything down", async () => {
    const removeWindow = vi.spyOn(window, "removeEventListener");
    const removeDocument = vi.spyOn(document, "removeEventListener");
    const { wrapper, setActive } = mountGlow(true);
    await nextTick();
    await setActive(false);
    expect(wrapper.get(GLOW).attributes("data-state")).toBe("leaving");
    expect(hosts[0].update).toHaveBeenCalledWith({ present: false });
    vi.advanceTimersByTime(COMPOSER_GLOW_FADE_OUT_MS - 1);
    await nextTick();
    expect(wrapper.find(GLOW).exists()).toBe(true);
    expect(hosts[0].dispose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await nextTick();
    await nextTick();
    expect(wrapper.find(GLOW).exists()).toBe(false);
    expect(hosts[0].dispose).toHaveBeenCalledTimes(1);
    expect(resizeObservers[0].disconnect).toHaveBeenCalled();
    expect(mutationObservers[0].disconnect).toHaveBeenCalled();
    const removed = (spy: typeof removeWindow, type: string) =>
      spy.mock.calls.some((call) => call[0] === type);
    expect(removed(removeWindow, "focus")).toBe(true);
    expect(removed(removeWindow, "blur")).toBe(true);
    expect(removed(removeDocument, "visibilitychange")).toBe(true);
    wrapper.unmount();
  });

  it("comes back mid fade-out with the same renderer", async () => {
    const { wrapper, setActive } = mountGlow(true);
    await nextTick();
    await setActive(false);
    vi.advanceTimersByTime(COMPOSER_GLOW_FADE_OUT_MS / 2);
    expect(hosts[0].update).toHaveBeenLastCalledWith({ present: false });
    await setActive(true);
    expect(wrapper.get(GLOW).attributes("data-state")).toBe("on");
    expect(hosts[0].update).toHaveBeenLastCalledWith({ present: true });
    vi.advanceTimersByTime(COMPOSER_GLOW_FADE_OUT_MS);
    await nextTick();
    expect(wrapper.find(GLOW).exists()).toBe(true);
    expect(hosts).toHaveLength(1);
    expect(hosts[0].dispose).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("starts a new run with new randomness", async () => {
    const values = [0.1, 0.9];
    let call = 0;
    vi.spyOn(Math, "random").mockImplementation(
      () => values[Math.floor(call++ / 100) % 2],
    );
    const { wrapper, setActive } = mountGlow(true);
    await nextTick();
    call = 100;
    await setActive(false);
    vi.advanceTimersByTime(COMPOSER_GLOW_FADE_OUT_MS);
    await nextTick();
    await setActive(true);
    await nextTick();
    expect(hosts).toHaveLength(2);
    expect(hosts[1].state.seed).not.toEqual(hosts[0].state.seed);
    wrapper.unmount();
  });

  it("moves to a fresh canvas on the page when the worker falls back", async () => {
    const { wrapper } = mountGlow(true);
    await nextTick();
    const first = wrapper.get("canvas").element;
    hosts[0].options.onFallback();
    await nextTick();
    await nextTick();
    expect(hosts[0].dispose).toHaveBeenCalled();
    expect(hosts).toHaveLength(2);
    expect(hosts[1].options.forceMain).toBe(true);
    expect(hosts[0].options.forceMain).toBe(false);
    const second = wrapper.get("canvas").element;
    expect(second).not.toBe(first);
    expect(hosts[1].canvas).toBe(second);
    wrapper.unmount();
  });

  it("tells the renderer about window focus and visibility", async () => {
    const { wrapper } = mountGlow(true);
    await nextTick();
    const { update } = hosts[0];
    focusSpy.mockReturnValue(false);
    window.dispatchEvent(new Event("blur"));
    expect(update).toHaveBeenLastCalledWith({
      activity: { focused: false, visible: true },
    });
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(update).toHaveBeenLastCalledWith({
      activity: { focused: false, visible: false },
    });
    update.mockClear();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(update).not.toHaveBeenCalled();
    visibility.mockRestore();
    wrapper.unmount();
  });

  it("follows the text box's size and skips unchanged colours", async () => {
    const { wrapper } = mountGlow(true);
    await nextTick();
    const { update } = hosts[0];
    const glow = wrapper.get(GLOW).element as HTMLElement;
    expect(glow.style.top).toBe("-28px");
    resizeObservers[0].callback();
    expect(update).not.toHaveBeenCalled();

    rectSpy.mockReturnValue(controlRect(700, 120));
    resizeObservers[0].callback();
    expect(update).toHaveBeenCalledTimes(1);
    const geometry = update.mock.calls[0][0].geometry;
    expect(geometry?.box.height).toBe(120);

    mutationObservers[0].callback();
    expect(update).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("updates the insets when the room changes", async () => {
    const { wrapper } = mountGlow(true);
    await nextTick();
    const glow = wrapper.get(GLOW).element as HTMLElement;
    // The control moves next to the window's top edge.
    rectSpy.mockReturnValue({ ...controlRect(700, 48), top: 10, y: 10 });
    resizeObservers[0].callback();
    await nextTick();
    expect(glow.style.top).toBe("-10px");
    wrapper.unmount();
  });

  it("places the canvas from the text box's border edge", async () => {
    const realStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const style = realStyle(element);
      if (!element.classList?.contains("control")) return style;
      return {
        ...style,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        overflow: style.overflow,
        borderTopLeftRadius: "24px",
        borderTopWidth: "1px",
        borderRightWidth: "1px",
        borderBottomWidth: "2px",
        borderLeftWidth: "1px",
      };
    });
    const { wrapper } = mountGlow(true);
    await nextTick();
    await nextTick();
    const glow = wrapper.get(GLOW).element as HTMLElement;
    const { margins } = hosts[0].state.geometry;
    expect(glow.style.top).toBe(`-${margins.top + 1}px`);
    expect(glow.style.right).toBe(`-${margins.right + 1}px`);
    expect(glow.style.bottom).toBe(`-${margins.bottom + 2}px`);
    expect(glow.style.left).toBe(`-${margins.left + 1}px`);
    wrapper.unmount();
  });

  it("re-measures when the window moves to another pixel density", async () => {
    const dpr = vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(1);
    const { wrapper } = mountGlow(true);
    await nextTick();
    const { state, update } = hosts[0];
    expect(state.geometry.ratio).toBe(0.75);
    const media = vi.mocked(window.matchMedia);
    const query = media.mock.results.find((result) =>
      String(result.value.media).includes("1dppx"),
    )?.value as { addEventListener: Mock };
    const listener = query.addEventListener.mock.calls[0][1] as () => void;
    dpr.mockReturnValue(2);
    listener();
    expect(update).toHaveBeenCalledWith({
      geometry: expect.objectContaining({ ratio: 1 }),
    });
    expect(media).toHaveBeenLastCalledWith("(resolution: 2dppx)");
    wrapper.unmount();
    expect(mediaListeners.has(listener)).toBe(false);
  });

  it("passes on reduced motion changes", async () => {
    const { wrapper } = mountGlow(true);
    await nextTick();
    reduceMotion = true;
    for (const listener of [...mediaListeners]) listener({ matches: true });
    await nextTick();
    expect(hosts[0].update).toHaveBeenCalledWith({ reducedMotion: true });
    wrapper.unmount();
  });

  it.each(["on", "leaving"])(
    "cleans up when unmounted while %s",
    async (state) => {
      const { wrapper, setActive } = mountGlow(true);
      await nextTick();
      if (state === "leaving") await setActive(false);
      wrapper.unmount();
      expect(hosts[0].dispose).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
