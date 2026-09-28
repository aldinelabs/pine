import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { animateScrollTop } from "@/lib/animateScroll";
import {
  measureContentHeight,
  provideMessageScroller,
} from "../useMessageScroller";

vi.mock("@/lib/animateScroll", () => ({ animateScrollTop: vi.fn() }));

function createScroller(followAnimated = false) {
  let engine!: ReturnType<typeof provideMessageScroller>;
  const wrapper = mount(
    defineComponent({
      setup() {
        engine = provideMessageScroller({ autoScroll: true, followAnimated });
        return () => null;
      },
    }),
  );
  const viewport = document.createElement("div");
  const content = document.createElement("div");
  const message = document.createElement("div");
  message.dataset.messageId = "message";
  content.append(message);
  viewport.append(content);
  document.body.append(viewport);
  let height = 2000;
  let offsetTop = 0;
  Object.defineProperties(viewport, {
    clientHeight: { get: () => 500 },
    scrollHeight: { get: () => offsetTop + height },
  });
  vi.spyOn(viewport, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, 400, 500),
  );
  vi.spyOn(message, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, offsetTop - viewport.scrollTop, 400, height),
  );
  vi.spyOn(viewport, "scrollTo").mockImplementation(
    (options: number | ScrollToOptions) => {
      if (typeof options === "object") viewport.scrollTop = options.top ?? 0;
    },
  );
  const context = engine.context;
  context.setViewportElement(viewport);
  context.setContentElement(content);
  context.handleContentChange();
  context.syncAfterScroll();
  return {
    context,
    viewport,
    grow() {
      height += 100;
      context.handleResize();
    },
    shiftBeforeMessage(amount: number) {
      offsetTop += amount;
      context.handleResize();
    },
    addTurnAnchor() {
      const anchor = document.createElement("div");
      anchor.dataset.messageId = "new-turn";
      anchor.dataset.scrollAnchor = "true";
      vi.spyOn(anchor, "getBoundingClientRect").mockImplementation(
        () => new DOMRect(0, 1500 - viewport.scrollTop, 400, 50),
      );
      content.append(anchor);
      context.handleContentChange();
    },
    destroy() {
      wrapper.unmount();
      viewport.remove();
    },
  };
}

function createAnchoredScroller(extraScrollHeight = 0) {
  let engine!: ReturnType<typeof provideMessageScroller>;
  const wrapper = mount(
    defineComponent({
      setup() {
        engine = provideMessageScroller({ autoScroll: true });
        return () => null;
      },
    }),
  );
  const viewport = document.createElement("div");
  const content = document.createElement("div");
  const message = document.createElement("div");
  const spacer = document.createElement("div");
  message.dataset.messageId = "message";
  content.append(message, spacer);
  viewport.append(content);
  document.body.append(viewport);

  let contentHeight = 2000;
  let responseHeight = 0;
  const spacerHeight = () => Number.parseFloat(spacer.style.height) || 0;
  const anchor = document.createElement("div");
  anchor.dataset.messageId = "new-turn";
  anchor.dataset.scrollAnchor = "true";
  const response = document.createElement("div");
  response.dataset.messageId = "response";

  Object.defineProperties(viewport, {
    clientHeight: { get: () => 500 },
    scrollHeight: {
      get: () => contentHeight + spacerHeight() + extraScrollHeight,
    },
  });
  vi.spyOn(viewport, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, 400, 500),
  );
  vi.spyOn(content, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, -viewport.scrollTop, 400, contentHeight),
  );
  vi.spyOn(message, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, -viewport.scrollTop, 400, 2000),
  );
  vi.spyOn(anchor, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 2000 - viewport.scrollTop, 400, 50),
  );
  vi.spyOn(response, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 2050 - viewport.scrollTop, 400, responseHeight),
  );
  vi.spyOn(viewport, "scrollTo").mockImplementation(
    (options: number | ScrollToOptions) => {
      if (typeof options === "object") viewport.scrollTop = options.top ?? 0;
    },
  );

  const context = engine.context;
  context.setViewportElement(viewport);
  context.setContentElement(content);
  context.setSpacerElement(spacer);
  context.handleContentChange();
  context.syncAfterScroll();

  return {
    context,
    viewport,
    spacer,
    startTurn() {
      contentHeight = 2050;
      content.insertBefore(anchor, spacer);
      content.insertBefore(response, spacer);
      context.handleContentChange();
    },
    grow(amount: number) {
      responseHeight += amount;
      contentHeight = 2050 + responseHeight;
      context.handleResize();
    },
    destroy() {
      wrapper.unmount();
      viewport.remove();
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("message scroller user intent", () => {
  it("measures transcript height from the tail instead of every message", () => {
    const viewport = document.createElement("div");
    const content = document.createElement("div");
    const messages = Array.from({ length: 100 }, () =>
      document.createElement("div"),
    );
    content.append(...messages);
    viewport.append(content);
    const contentRect = vi
      .spyOn(content, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 400, 10_000));
    const messageRects = messages.map((message, index) =>
      vi
        .spyOn(message, "getBoundingClientRect")
        .mockReturnValue(new DOMRect(0, index * 100, 400, 100)),
    );

    expect(measureContentHeight({ content, spacer: null, viewport })).toBe(
      10_000,
    );
    expect(contentRect).toHaveBeenCalledOnce();
    expect(messageRects.at(-1)).toHaveBeenCalledOnce();
    expect(
      messageRects.slice(0, -1).every((spy) => spy.mock.calls.length === 0),
    ).toBe(true);
  });

  it("does not resume following after a small upward scroll inside the edge threshold", () => {
    const scroller = createScroller();
    const { context, viewport } = scroller;
    expect(viewport.scrollTop).toBe(1500);
    context.userScrollIntent();
    // A pending state callback may run before the wheel changes scrollTop.
    context.syncAfterScroll();
    viewport.scrollTop -= 4;
    context.syncAfterScroll();
    scroller.grow();
    expect(viewport.scrollTop).toBe(1496);
    scroller.destroy();
  });

  it("preserves the visible message when content above it settles", () => {
    const scroller = createScroller();
    const { context, viewport } = scroller;
    context.userScrollIntent();
    viewport.scrollTop = 1000;
    context.syncAfterScroll();
    const before = viewport.scrollTop;

    scroller.shiftBeforeMessage(120);

    expect(viewport.scrollTop).toBe(before + 120);
    scroller.destroy();
  });

  it("keeps a new turn anchor in place while streaming thinking opens", () => {
    const scroller = createScroller();
    scroller.addTurnAnchor();
    expect(scroller.viewport.scrollTop).toBe(1436);

    scroller.context.followStreamingContent();

    expect(scroller.viewport.scrollTop).toBe(1436);
    scroller.destroy();
  });

  it("shrinks the anchor spacer as the response fills the viewport", () => {
    const scroller = createAnchoredScroller();
    scroller.startTurn();

    expect(scroller.viewport.scrollTop).toBe(1936);
    expect(scroller.spacer.style.height).toBe("386px");

    scroller.context.followStreamingContent();

    expect(scroller.viewport.scrollTop).toBe(1936);
    expect(scroller.spacer.style.height).toBe("386px");

    scroller.grow(100);
    expect(scroller.viewport.scrollTop).toBe(1936);
    expect(scroller.spacer.style.height).toBe("286px");

    scroller.grow(286);
    expect(scroller.viewport.scrollTop).toBe(1936);
    expect(scroller.spacer.hidden).toBe(true);
    scroller.destroy();
  });

  it("keeps shrinking the spacer after the reader scrolls away from the anchor", () => {
    const scroller = createAnchoredScroller();
    scroller.startTurn();
    scroller.context.userScrollIntent("start");
    scroller.viewport.scrollTop = 1800;
    scroller.context.syncAfterScroll();

    scroller.grow(100);
    expect(scroller.viewport.scrollTop).toBe(1800);
    expect(scroller.spacer.style.height).toBe("286px");

    scroller.grow(300);
    expect(scroller.viewport.scrollTop).toBe(1800);
    expect(scroller.spacer.hidden).toBe(true);

    scroller.destroy();
  });

  it("clears the spacer when the reader returns to the live edge", () => {
    const scroller = createAnchoredScroller();
    scroller.startTurn();
    scroller.context.userScrollIntent("start");
    scroller.viewport.scrollTop = 1800;
    scroller.context.syncAfterScroll();

    scroller.viewport.scrollTop = 1936;
    scroller.context.syncAfterScroll();

    expect(scroller.spacer.hidden).toBe(true);
    scroller.destroy();
  });

  it("removes excess scroll range below a newly anchored message", () => {
    const scroller = createAnchoredScroller(64);
    scroller.startTurn();

    expect(scroller.viewport.scrollTop).toBe(1936);
    expect(scroller.spacer.style.height).toBe("322px");
    expect(
      scroller.viewport.scrollHeight - scroller.viewport.clientHeight,
    ).toBe(scroller.viewport.scrollTop);

    scroller.destroy();
  });

  it("does not follow streaming thinking after the reader scrolls up", () => {
    const scroller = createScroller();
    scroller.addTurnAnchor();
    scroller.context.userScrollIntent();
    scroller.viewport.scrollTop = 1000;
    scroller.context.syncAfterScroll();

    scroller.context.followStreamingContent();

    expect(scroller.viewport.scrollTop).toBe(1000);
    scroller.destroy();
  });

  it("resumes following after the reader scrolls down to the live edge", () => {
    const scroller = createScroller();
    const { context, viewport } = scroller;
    context.userScrollIntent();
    viewport.scrollTop = 1200;
    context.syncAfterScroll();
    scroller.grow();
    expect(viewport.scrollTop).toBe(1200);
    viewport.scrollTop = 1600;
    context.syncAfterScroll();
    scroller.grow();
    expect(viewport.scrollTop).toBe(1700);
    scroller.destroy();
  });

  it("keeps following after another downward intent at the live edge", () => {
    const scroller = createScroller();
    const { context, viewport } = scroller;
    context.userScrollIntent();
    viewport.scrollTop = 1200;
    context.syncAfterScroll();
    viewport.scrollTop = 1500;
    context.syncAfterScroll();

    // A wheel event at the edge does not produce another scroll event. It
    // must not turn an already-restored follow mode back into free scrolling.
    context.userScrollIntent("end");
    scroller.grow();

    expect(viewport.scrollTop).toBe(1600);
    scroller.destroy();
  });

  it("cancels a follow animation on user intent and ignores pending resize callbacks", () => {
    const cancel = vi.fn();
    vi.mocked(animateScrollTop).mockReturnValue(cancel);
    const scroller = createScroller(true);
    scroller.grow();
    expect(animateScrollTop).toHaveBeenCalledTimes(1);
    scroller.context.userScrollIntent();
    expect(cancel).toHaveBeenCalledOnce();
    expect(scroller.context.autoscrolling.value).toBe(false);
    scroller.grow();
    expect(animateScrollTop).toHaveBeenCalledTimes(1);
    scroller.destroy();
  });

  it("cancels an in-flight animation when jumping or unmounting", () => {
    const cancel = vi.fn();
    vi.mocked(animateScrollTop).mockReturnValue(cancel);
    const scroller = createScroller(true);
    scroller.grow();
    scroller.context.scrollToStart();
    expect(cancel).toHaveBeenCalledOnce();
    expect(scroller.viewport.scrollTop).toBe(0);
    scroller.context.scrollToEnd();
    scroller.grow();
    scroller.destroy();
    expect(cancel).toHaveBeenCalledTimes(2);
  });
});
