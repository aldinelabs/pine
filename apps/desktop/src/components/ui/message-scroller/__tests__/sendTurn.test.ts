import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { animateScrollTop } from "@/lib/animateScroll";
import { provideMessageScroller } from "../useMessageScroller";

vi.mock("@/lib/animateScroll", () => ({
  animateScrollTop: vi.fn(),
  isScrollAnimating: vi.fn(() => false),
}));

function row(top: () => number, height: () => number, id?: string) {
  const element = document.createElement("div");
  if (id) element.dataset.messageId = id;
  vi.spyOn(element, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, top(), 400, height()),
  );
  return element;
}

/**
 * A 500px viewport over 2000px of history, followed by a status row with no
 * message id that stays after the last message (like the waiting-for-reply
 * note). The reader has scrolled up to the top.
 */
function createTranscript() {
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
  const spacer = document.createElement("div");
  viewport.append(content);
  document.body.append(viewport);

  let contentHeight = 2000;
  const spacerHeight = () => Number.parseFloat(spacer.style.height) || 0;
  const at = (offset: number) => () => offset - viewport.scrollTop;
  const history = row(at(0), () => 2000, "history");
  const status = row(at(2000), () => 0);
  const sent = row(at(2000), () => 100, "sent");
  sent.dataset.scrollAnchor = "true";
  content.append(history, status, spacer);

  Object.defineProperties(viewport, {
    clientHeight: { get: () => 500 },
    scrollHeight: { get: () => contentHeight + spacerHeight() },
  });
  vi.spyOn(viewport, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, 400, 500),
  );
  vi.spyOn(content, "getBoundingClientRect").mockImplementation(
    () =>
      new DOMRect(0, -viewport.scrollTop, 400, contentHeight + spacerHeight()),
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
  context.userScrollIntent("start");
  viewport.scrollTop = 0;
  context.syncAfterScroll();

  return {
    context,
    viewport,
    sentTop: () => sent.getBoundingClientRect().top,
    send() {
      contentHeight = 2100;
      content.insertBefore(sent, status);
      context.handleContentChange();
    },
    destroy() {
      wrapper.unmount();
      viewport.remove();
    },
  };
}

beforeEach(() => {
  vi.mocked(animateScrollTop).mockImplementation((element, top) => {
    element.scrollTop = top;
    return () => {};
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

it("scrolls to a sent turn that lands before a trailing status row", () => {
  const transcript = createTranscript();
  expect(transcript.viewport.scrollTop).toBe(0);

  transcript.send();

  expect(animateScrollTop).toHaveBeenCalled();
  // The sent turn rests near the top, below the previous item's peek.
  const top = transcript.sentTop();
  expect(top).toBeGreaterThan(0);
  expect(top).toBeLessThan(100);
  transcript.destroy();
});
