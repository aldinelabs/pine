import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { animateScrollTop, isScrollAnimating } from "@/lib/animateScroll";
import { provideMessageScroller } from "../useMessageScroller";

vi.mock("@/lib/animateScroll", () => ({
  prefersReducedMotion: vi.fn(() => false),
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
function createTranscript({ atEnd = false }: { atEnd?: boolean } = {}) {
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
  if (!atEnd) {
    context.userScrollIntent("start");
    viewport.scrollTop = 0;
    context.syncAfterScroll();
  }

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

it("leaves the view where it is for a turn sent with the view held", () => {
  const transcript = createTranscript();
  transcript.context.holdViewForNextTurn();

  transcript.send();

  expect(animateScrollTop).not.toHaveBeenCalled();
  expect(transcript.viewport.scrollTop).toBe(0);
  expect(transcript.context.isFollowingBottom()).toBe(false);
  transcript.destroy();
});

it("keeps following the bottom for a held turn sent from the bottom", () => {
  const transcript = createTranscript({ atEnd: true });
  expect(transcript.context.isFollowingBottom()).toBe(true);
  transcript.context.holdViewForNextTurn();

  transcript.send();

  expect(transcript.context.isFollowingBottom()).toBe(true);
  expect(transcript.viewport.scrollTop).toBe(2100 - 500);
  transcript.destroy();
});

it("scrolls to the turn again once a hold is revealed or released", () => {
  const revealed = createTranscript();
  revealed.context.holdViewForNextTurn();
  revealed.context.revealNextTurn();
  revealed.send();
  expect(revealed.sentTop()).toBeLessThan(100);
  revealed.destroy();

  const released = createTranscript();
  released.context.holdViewForNextTurn();
  released.context.releaseTurnHold();
  released.send();
  expect(released.sentTop()).toBeLessThan(100);
  released.destroy();
});

it("takes a reader in the history to the live end for a steer", () => {
  const transcript = createTranscript();
  transcript.context.revealNextTurn({ scrollToEnd: true });

  expect(transcript.viewport.scrollTop).toBe(2000 - 500);
  expect(transcript.context.isFollowingBottom()).toBe(true);
  transcript.destroy();
});

it("shows the scroll-to-end state away from the bottom and follows again from it", async () => {
  const transcript = createTranscript();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(transcript.context.scrollable.value.end).toBe(true);

  // What the scroll-to-bottom button does.
  transcript.context.scrollToEnd({ behavior: "smooth" });

  expect(transcript.viewport.scrollTop).toBe(2000 - 500);
  expect(transcript.context.isFollowingBottom()).toBe(true);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(transcript.context.scrollable.value.end).toBe(false);
  transcript.destroy();
});

it("pins the tail only once a smooth scroll to the end arrives", async () => {
  const transcript = createTranscript();
  let animating = false;
  vi.mocked(animateScrollTop).mockImplementation(() => {
    animating = true;
    return () => {};
  });
  vi.mocked(isScrollAnimating).mockImplementation(() => animating);
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  transcript.context.scrollToEnd({ behavior: "smooth" });
  await frame();
  // Following already, but the tail stays in flow while the view travels.
  expect(transcript.context.isFollowingBottom()).toBe(true);
  expect(transcript.context.tailPinned.value).toBe(false);

  transcript.viewport.scrollTop = 2000 - 500;
  animating = false;
  transcript.context.syncAfterScroll();
  await frame();
  expect(transcript.context.tailPinned.value).toBe(true);
  vi.mocked(isScrollAnimating).mockImplementation(() => false);
  transcript.destroy();
});

it("pins the tail at once for a jump to the end", () => {
  const transcript = createTranscript();
  transcript.context.scrollToEnd({ behavior: "auto" });
  expect(transcript.context.tailPinned.value).toBe(true);
  transcript.destroy();
});
