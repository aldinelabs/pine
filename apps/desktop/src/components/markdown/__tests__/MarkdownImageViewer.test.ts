import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createAppI18n } from "@/app/i18n";
import MarkdownContent from "../MarkdownContent.vue";
import { flipTransform } from "../imageViewerFlight";
import { markdownImageName } from "../markdownImageContext";

const SOURCE_RECT = { left: 40, top: 300, width: 200, height: 100 };
const STAGE_RECT = { left: 100, top: 64, width: 800, height: 400 };
const NATURAL = { width: 2000, height: 1000 };
const STAGE_SIZE = { width: 1000, height: 700 };

interface AnimateCall {
  element: HTMLElement;
  keyframes: Keyframe[] | PropertyIndexedKeyframes;
  /** The first document image's inline opacity when this animation began. */
  sourceOpacity: string;
}

let animateCalls: AnimateCall[] = [];
let sourceRect: { left: number; top: number; width: number; height: number } =
  SOURCE_RECT;
let stageRect = STAGE_RECT;
let natural = NATURAL;
let reducedMotion = false;
const restorers: (() => void)[] = [];

function stub(
  target: object,
  key: string,
  descriptor: PropertyDescriptor,
): void {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, ...descriptor });
  restorers.push(() => {
    if (original) Object.defineProperty(target, key, original);
    else delete (target as Record<string, unknown>)[key];
  });
}

function rect(value: {
  left: number;
  top: number;
  width: number;
  height: number;
}) {
  return {
    ...value,
    x: value.left,
    y: value.top,
    right: value.left + value.width,
    bottom: value.top + value.height,
    toJSON: () => value,
  } as DOMRect;
}

function findDescriptor(target: object, key: string): PropertyDescriptor {
  for (
    let proto: object | null = target;
    proto;
    proto = Object.getPrototypeOf(proto)
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, key);
    if (descriptor) return descriptor;
  }
  throw new Error(`No ${key}`);
}

function installStubs(): void {
  animateCalls = [];
  sourceRect = SOURCE_RECT;
  stageRect = STAGE_RECT;
  natural = NATURAL;
  reducedMotion = false;
  const elementRect = findDescriptor(
    HTMLElement.prototype,
    "getBoundingClientRect",
  ).value as () => DOMRect;
  stub(HTMLElement.prototype, "getBoundingClientRect", {
    value(this: HTMLElement) {
      if (this instanceof HTMLImageElement) {
        if (this.closest('[data-slot="image-preview"]')) return rect(stageRect);
        if (this.closest("[data-markdown-image]")) return rect(sourceRect);
      }
      return elementRect.call(this);
    },
  });
  stub(HTMLElement.prototype, "animate", {
    value(this: HTMLElement, keyframes: Keyframe[] | PropertyIndexedKeyframes) {
      const source = document.querySelector<HTMLElement>(
        "[data-markdown-image] img",
      );
      animateCalls.push({
        element: this,
        keyframes,
        sourceOpacity: source?.style.opacity ?? "",
      });
      return {
        finished: Promise.resolve(),
        cancel: vi.fn(),
        finish: vi.fn(),
      } as unknown as Animation;
    },
  });
  stub(HTMLImageElement.prototype, "naturalWidth", {
    get: () => natural.width,
  });
  stub(HTMLImageElement.prototype, "naturalHeight", {
    get: () => natural.height,
  });
  for (const [key, size] of [
    ["clientWidth", STAGE_SIZE.width],
    ["clientHeight", STAGE_SIZE.height],
  ] as const) {
    const original = findDescriptor(HTMLElement.prototype, key);
    stub(HTMLElement.prototype, key, {
      get(this: HTMLElement) {
        return this.dataset.slot === "image-preview"
          ? size
          : (original.get!.call(this) as number);
      },
    });
  }
  stub(window, "matchMedia", {
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion") && reducedMotion,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }),
  });
}

function mountMarkdown(source: string, zoomableImages = true) {
  return mount(MarkdownContent, {
    attachTo: document.body,
    props: { source, final: true, zoomableImages },
    global: { plugins: [createAppI18n("en-US")] },
  });
}

function dialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(
    '[data-slot="markdown-image-viewer"]',
  );
}

function flightImage(): HTMLImageElement | null {
  return document.body.querySelector<HTMLImageElement>(
    '[data-slot="markdown-image-flight"]',
  );
}

function stageImage(): HTMLImageElement | null {
  return document.body.querySelector<HTMLImageElement>(
    '[data-slot="markdown-image-viewer"] [data-slot="image-preview"] img',
  );
}

/** Waits until the view finished opening: the stage shows, the copy is gone. */
async function openedViewer(): Promise<HTMLElement> {
  return vi.waitFor(() => {
    const content = dialog();
    expect(content?.getAttribute("data-state")).toBe("open");
    const stage = content!.querySelector<HTMLElement>(
      '[data-slot="image-preview"]',
    )!.parentElement!;
    expect(stage.style.opacity).toBe("1");
    expect(flightImage()?.style.display).toBe("none");
    return content!;
  });
}

async function closedViewer(): Promise<void> {
  await vi.waitFor(() => expect(dialog()).toBeNull());
}

function key(target: HTMLElement, init: KeyboardEventInit): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, ...init }),
  );
}

async function loadImages(
  wrapper: ReturnType<typeof mountMarkdown>,
): Promise<void> {
  for (const image of wrapper.findAll("img")) await image.trigger("load");
  await flushPromises();
}

function hasMotion(keyframes: Keyframe[] | PropertyIndexedKeyframes): boolean {
  return /translate|scale/u.test(JSON.stringify(keyframes));
}

describe("Markdown image viewer", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    installStubs();
  });
  afterEach(() => {
    document.body.innerHTML = "";
    while (restorers.length) restorers.pop()!();
  });

  it("opens the clicked image enlarged and closes on Escape", async () => {
    const wrapper = mountMarkdown(
      "![First chart](/docs/first.png)\n\n![](/docs/second%20plot.png)",
    );
    await flushPromises();
    await loadImages(wrapper);

    const second = wrapper.findAll("img")[1];
    expect(second.attributes("role")).toBe("button");
    expect(second.attributes("tabindex")).toBe("0");
    expect(second.classes()).toContain("cursor-zoom-in");
    await second.trigger("click");
    const content = await openedViewer();
    expect(content.querySelector("h2")?.textContent?.trim()).toBe(
      "second plot.png",
    );
    expect(stageImage()?.getAttribute("src")).toBe(second.attributes("src"));
    expect(content.textContent).toContain("2 / 2");

    key(content, { key: "ArrowRight" });
    await flushPromises();
    expect(dialog()?.querySelector("h2")?.textContent?.trim()).toBe(
      "First chart",
    );

    key(content, { key: "Escape" });
    await closedViewer();
    wrapper.unmount();
  });

  it("opens a focused image with Enter", async () => {
    const wrapper = mountMarkdown("![Diagram](/docs/diagram.png)");
    await flushPromises();
    await loadImages(wrapper);
    await wrapper.get("img").trigger("keydown", { key: "Enter" });
    await openedViewer();
    wrapper.unmount();
  });

  it("flies the image from its place in the document", async () => {
    const wrapper = mountMarkdown("![Plot](/docs/plot.png)");
    await flushPromises();
    await loadImages(wrapper);
    const source = wrapper.get("img").element as HTMLImageElement;
    source.style.opacity = "0.9";
    await wrapper.get("img").trigger("click");
    await openedViewer();

    const flight = animateCalls.find((call) => call.element === flightImage())!;
    const transform = (flight.keyframes as PropertyIndexedKeyframes)
      .transform as string[];
    expect(transform[0]).toBe(flipTransform(SOURCE_RECT, STAGE_RECT));
    expect(transform[0]).toBe("translate(-60px, 236px) scale(0.25, 0.25)");
    expect(transform.at(-1)).toBe("none");
    // The document image hides while its copy flies.
    expect(flight.sourceOpacity).toBe("0");
    expect(
      animateCalls.some(
        (call) =>
          JSON.stringify(call.keyframes) ===
          JSON.stringify({ opacity: [0, 1] }),
      ),
    ).toBe(true);
    expect(flightImage()?.style.display).toBe("none");
    expect(source.style.opacity).toBe("0.9");
    wrapper.unmount();
  });

  it("flies back on close, or fades when the image is out of view", async () => {
    const wrapper = mountMarkdown("![Plot](/docs/plot.png)");
    await flushPromises();
    await loadImages(wrapper);
    await wrapper.get("img").trigger("click");
    let content = await openedViewer();

    animateCalls = [];
    key(content, { key: "Escape" });
    await closedViewer();
    // The copy is detached with the view; find it by its keyframes.
    const back = animateCalls.find(
      (call) =>
        call.element.dataset.slot === "markdown-image-flight" &&
        hasMotion(call.keyframes),
    )!;
    expect((back.keyframes as PropertyIndexedKeyframes).transform).toEqual([
      "none",
      flipTransform(SOURCE_RECT, STAGE_RECT),
    ]);
    expect(back.sourceOpacity).toBe("0");
    expect((wrapper.get("img").element as HTMLElement).style.opacity).toBe("");

    sourceRect = { left: 40, top: 2000, width: 200, height: 100 };
    await wrapper.get("img").trigger("click");
    content = await openedViewer();
    animateCalls = [];
    key(content, { key: "Escape" });
    await closedViewer();
    expect(animateCalls.length).toBeGreaterThan(0);
    expect(
      animateCalls.some((call) =>
        JSON.stringify(call.keyframes).includes("translate(-"),
      ),
    ).toBe(false);
    wrapper.unmount();
  });

  it("fades instead of flying back from a stage larger than the window", async () => {
    const wrapper = mountMarkdown("![Plot](/docs/plot.png)");
    await flushPromises();
    await loadImages(wrapper);
    await wrapper.get("img").trigger("click");
    const content = await openedViewer();

    // Zoomed far in: the stage image is many times the window's size.
    stageRect = { left: -3000, top: -1500, width: 8000, height: 4000 };
    animateCalls = [];
    key(content, { key: "Escape" });
    await closedViewer();
    expect(animateCalls.length).toBeGreaterThan(0);
    expect(
      animateCalls.some(
        (call) =>
          call.element.dataset.slot === "markdown-image-flight" ||
          hasMotion(call.keyframes),
      ),
    ).toBe(false);
    expect((wrapper.get("img").element as HTMLElement).style.opacity).toBe("");
    wrapper.unmount();
  });

  it("floats the title, close button and toolbar without a card", async () => {
    const wrapper = mountMarkdown(
      "![One](/docs/one.png)\n\n![Two](/docs/two.png)",
    );
    await flushPromises();
    await loadImages(wrapper);
    await wrapper.get("img").trigger("click");
    const content = await openedViewer();
    expect(
      content
        .querySelector('[data-testid="markdown-image-close"]')
        ?.getAttribute("aria-label"),
    ).toBe("Close image");
    const toolbar = content.querySelector('[role="toolbar"]')!;
    for (const id of [
      "markdown-image-fit",
      "markdown-image-zoom-out",
      "markdown-image-zoom-value",
      "markdown-image-zoom-in",
      "markdown-image-previous",
      "markdown-image-next",
    ]) {
      expect(toolbar.querySelector(`[data-testid="${id}"]`)).not.toBeNull();
    }
    expect(toolbar.textContent).toContain("1 / 2");
    expect(toolbar.textContent).toMatch(/\d+%/u);
    expect(content.className).not.toMatch(/rounded-4xl|bg-popover/u);
    wrapper.unmount();

    const single = mountMarkdown("![Only](/docs/only.png)");
    await flushPromises();
    await loadImages(single);
    await single.get("img").trigger("click");
    const lone = await openedViewer();
    expect(
      lone.querySelector('[data-testid="markdown-image-next"]'),
    ).toBeNull();
    expect(lone.querySelector('[role="toolbar"]')?.textContent).not.toContain(
      "/",
    );
    single.unmount();
  });

  it("zooms and switches images from the keyboard", async () => {
    const wrapper = mountMarkdown(
      "![One](/docs/one.png)\n\n![Two](/docs/two.png)\n\n![Three](/docs/three.png)",
    );
    await flushPromises();
    await loadImages(wrapper);
    await wrapper.get("img").trigger("click");
    const content = await openedViewer();
    const readout = () =>
      Number.parseInt(
        content.querySelector('[data-testid="markdown-image-zoom-value"]')!
          .textContent,
        10,
      );
    // (1000 - 48) / 2000 against (700 - 144) / 1000.
    await vi.waitFor(() => expect(readout()).toBe(48));
    key(content, { key: "=", metaKey: true });
    await flushPromises();
    expect(readout()).toBeGreaterThan(48);
    key(content, { key: "-", metaKey: true });
    key(content, { key: "-", metaKey: true });
    await flushPromises();
    expect(readout()).toBeLessThan(48);
    key(content, { key: "0", ctrlKey: true });
    await flushPromises();
    expect(readout()).toBe(48);

    key(content, { key: "ArrowLeft" });
    await flushPromises();
    expect(content.querySelector("h2")?.textContent?.trim()).toBe("Three");
    expect(content.textContent).toContain("3 / 3");
    wrapper.unmount();
  });

  it("focuses the view and returns focus to the image", async () => {
    const wrapper = mountMarkdown("![Plot](/docs/plot.png)");
    await flushPromises();
    await loadImages(wrapper);
    const source = wrapper.get("img").element as HTMLImageElement;
    source.focus();
    await wrapper.get("img").trigger("keydown", { key: "Enter" });
    const content = await openedViewer();
    expect(document.activeElement).toBe(content);
    key(content, { key: "Escape" });
    await closedViewer();
    await vi.waitFor(() => expect(document.activeElement).toBe(source));
    wrapper.unmount();
  });

  it("closes on a click beside the image but not on the image", async () => {
    const wrapper = mountMarkdown("![Plot](/docs/plot.png)");
    await flushPromises();
    await loadImages(wrapper);
    await wrapper.get("img").trigger("click");
    const content = await openedViewer();
    stageImage()!.click();
    await flushPromises();
    expect(dialog()?.getAttribute("data-state")).toBe("open");
    content
      .querySelector<HTMLElement>('[data-slot="image-preview"] > div')!
      .click();
    await closedViewer();
    wrapper.unmount();
  });

  it("only fades with reduced motion", async () => {
    reducedMotion = true;
    const wrapper = mountMarkdown("![Plot](/docs/plot.png)");
    await flushPromises();
    await loadImages(wrapper);
    await wrapper.get("img").trigger("click");
    const content = await openedViewer();
    key(content, { key: "Escape" });
    await closedViewer();
    expect(animateCalls.length).toBeGreaterThan(0);
    expect(animateCalls.some((call) => hasMotion(call.keyframes))).toBe(false);
    expect(animateCalls.every((call) => call.sourceOpacity === "")).toBe(true);
    expect((wrapper.get("img").element as HTMLElement).style.opacity).toBe("");
    wrapper.unmount();
  });

  it("does not zoom a broken or unloaded image", async () => {
    const wrapper = mountMarkdown(
      "![Broken](/docs/missing.png)\n\n![Pending](/docs/pending.png)",
    );
    await flushPromises();
    const [broken, pending] = wrapper.findAll("img");
    await pending.trigger("click");
    await broken.trigger("error");
    await flushPromises();
    expect(wrapper.findAll("img")).toHaveLength(1);
    expect(wrapper.text()).toContain("Image failed to load");
    expect(wrapper.get("img").attributes("role")).toBeUndefined();
    expect(dialog()).toBeNull();
    wrapper.unmount();
  });

  it("leaves images inline where the renderer does not opt in", async () => {
    const wrapper = mountMarkdown("![Chat](/docs/chat.png)", false);
    await flushPromises();
    await loadImages(wrapper);
    const image = wrapper.get("img");
    expect(image.attributes("role")).toBeUndefined();
    await image.trigger("click");
    await flushPromises();
    expect(dialog()).toBeNull();
    wrapper.unmount();
  });

  it("preloads the viewer when a zoomable image loads", async () => {
    vi.resetModules();
    const idle = vi.fn();
    stub(window, "requestIdleCallback", { value: idle });
    const { default: FreshContent } = await import("../MarkdownContent.vue");
    const mountFresh = (zoomableImages: boolean) =>
      mount(FreshContent, {
        attachTo: document.body,
        props: {
          source: "![A](/docs/a.png)\n\n![B](/docs/b.png)",
          final: true,
          zoomableImages,
        },
        global: { plugins: [createAppI18n("en-US")] },
      });

    const inline = mountFresh(false);
    await flushPromises();
    for (const image of inline.findAll("img")) await image.trigger("load");
    expect(idle).not.toHaveBeenCalled();
    inline.unmount();

    const zoomable = mountFresh(true);
    await flushPromises();
    for (const image of zoomable.findAll("img")) await image.trigger("load");
    expect(idle).toHaveBeenCalledTimes(1);
    zoomable.unmount();
  });

  it("names an image by its alt text, else its file name", () => {
    expect(markdownImageName(" Plot ", "a/b.png")).toBe("Plot");
    expect(markdownImageName("", "./figures/my%20chart.png?x=1")).toBe(
      "my chart.png",
    );
    expect(markdownImageName("", "data:image/png;base64,AAAA")).toBe("");
  });
});
