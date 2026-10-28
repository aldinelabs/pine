import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import HtmlFrame from "../HtmlFrame.vue";

async function mountFrame() {
  const wrapper = mount(HtmlFrame, {
    props: { html: "<p>Hello</p>", title: "Page" },
  });
  const viewport = wrapper.element as HTMLElement;
  Object.defineProperty(viewport, "clientWidth", { value: 400 });
  Object.defineProperty(viewport, "clientHeight", { value: 300 });
  const frame = wrapper.get("iframe");
  // The test environment gives srcdoc frames no document of their own.
  const page = document.implementation.createHTMLDocument("page");
  Object.defineProperty(frame.element, "contentDocument", { value: page });
  await frame.trigger("load");
  return { wrapper, frame, page };
}

/** The test environment's events ignore modifier keys, so they are set. */
function withModifier<T extends Event>(event: T, key: string): T {
  Object.defineProperty(event, key, { value: true });
  return event;
}

function pinch(deltaY: number, clientX = 0, clientY = 0): WheelEvent {
  const event = new WheelEvent("wheel", { deltaY, cancelable: true });
  Object.defineProperty(event, "clientX", { value: clientX });
  Object.defineProperty(event, "clientY", { value: clientY });
  return withModifier(event, "ctrlKey");
}

type Mounted = Awaited<ReturnType<typeof mountFrame>>;
const magnifier = ({ wrapper }: Mounted) =>
  (wrapper.get('[data-slot="html-frame-magnifier"]').element as HTMLElement)
    .style.transform;

describe("HtmlFrame", () => {
  it("runs no scripts in the page", async () => {
    const { frame } = await mountFrame();
    expect(frame.attributes("sandbox")).toBe("allow-same-origin");
    expect(frame.attributes("srcdoc")).toContain("default-src 'none'");
  });

  it("magnifies the page under the pointer on a pinch, without page zoom", async () => {
    const mounted = await mountFrame();
    const event = pinch(-100 * Math.LN2, 100, 50);
    mounted.page.dispatchEvent(event);
    await nextTick();

    expect(event.defaultPrevented).toBe(true);
    // Twice the size, with the point under the pointer kept in place.
    expect(magnifier(mounted)).toBe("translate(-100px, -50px) scale(2)");
    expect(mounted.frame.attributes("style")).toContain("scale(1)");
  });

  it("pans a magnified page before the page scrolls", async () => {
    const mounted = await mountFrame();
    const { page } = mounted;
    page.dispatchEvent(pinch(-100 * Math.LN2));
    const pan = new WheelEvent("wheel", { deltaY: 120, cancelable: true });
    page.dispatchEvent(pan);
    await nextTick();
    expect(pan.defaultPrevented).toBe(true);
    expect(magnifier(mounted)).toBe("translate(0px, -120px) scale(2)");

    // At the bottom edge the page scrolls by itself.
    page.dispatchEvent(new WheelEvent("wheel", { deltaY: 1000 }));
    const scroll = new WheelEvent("wheel", { deltaY: 50, cancelable: true });
    page.dispatchEvent(scroll);
    expect(scroll.defaultPrevented).toBe(false);

    page.dispatchEvent(pinch(500));
    await nextTick();
    expect(magnifier(mounted)).toBe("");
  });

  it("hands zoom shortcuts typed in the page to the preview", async () => {
    const { frame, page } = await mountFrame();
    const keys: string[] = [];
    frame.element.addEventListener("keydown", (event) => keys.push(event.key));

    const zoomIn = withModifier(
      new KeyboardEvent("keydown", { key: "=", cancelable: true }),
      "metaKey",
    );
    page.dispatchEvent(zoomIn);
    page.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));

    expect(zoomIn.defaultPrevented).toBe(true);
    expect(keys).toEqual(["="]);
  });
});
