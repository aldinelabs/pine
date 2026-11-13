import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { animateScrollTop } from "@/lib/animateScroll";
import { provideMessageScroller } from "../useMessageScroller";

vi.mock("@/lib/animateScroll", () => ({
  animateScrollTop: vi.fn(),
  isScrollAnimating: vi.fn(() => false),
}));

function row(id: string, top: () => number, height: () => number) {
  const element = document.createElement("div");
  element.dataset.messageId = id;
  vi.spyOn(element, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, top(), 400, height()),
  );
  return element;
}

/**
 * A 500px viewport over `first` (0-1000), the user message being edited
 * (1000-1100) and its reply (1100-1400), scrolled to the end, so the edited
 * message sits 100px below the viewport's top.
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

  let contentHeight = 1400;
  let replyHeight = 0;
  const spacerHeight = () => Number.parseFloat(spacer.style.height) || 0;
  const minHeight = () => Number.parseFloat(content.style.minHeight) || 0;
  const scrollHeight = () =>
    Math.max(contentHeight + spacerHeight(), minHeight());
  /** The browser clamps the scroll position to the scroll range. */
  const clamp = () => {
    viewport.scrollTop = Math.min(viewport.scrollTop, scrollHeight() - 500);
  };
  const at = (offset: number) => () => offset - viewport.scrollTop;

  const first = row("first", at(0), () => 1000);
  const edited = row("edited", at(1000), () => 100);
  edited.dataset.scrollAnchor = "true";
  const reply = row("reply", at(1100), () => 300);
  const rewritten = row("rewritten", at(1000), () => 100);
  rewritten.dataset.scrollAnchor = "true";
  const newReply = row("new-reply", at(1100), () => replyHeight);
  content.append(first, edited, reply, spacer);

  Object.defineProperties(viewport, {
    clientHeight: { get: () => 500 },
    scrollHeight: { get: scrollHeight },
  });
  vi.spyOn(viewport, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, 400, 500),
  );
  vi.spyOn(content, "getBoundingClientRect").mockImplementation(
    () =>
      new DOMRect(0, -viewport.scrollTop, 400, contentHeight + spacerHeight()),
  );
  const scrollTo = vi
    .spyOn(viewport, "scrollTo")
    .mockImplementation((options: number | ScrollToOptions) => {
      if (typeof options === "object") viewport.scrollTop = options.top ?? 0;
    });

  const context = engine.context;
  context.setViewportElement(viewport);
  context.setContentElement(content);
  context.setSpacerElement(spacer);
  context.handleContentChange();
  context.syncAfterScroll();
  viewport.scrollTop = 900;
  context.syncAfterScroll();

  return {
    context,
    content,
    viewport,
    scrollTo,
    rewritten,
    removeEditedTurn() {
      edited.remove();
      reply.remove();
      contentHeight = 1000;
      clamp();
      context.handleContentChange();
      context.handleResize();
    },
    arrive() {
      contentHeight = 1100;
      content.insertBefore(rewritten, spacer);
      content.insertBefore(newReply, spacer);
      context.handleContentChange();
      context.handleResize();
    },
    stream(amount: number) {
      replyHeight += amount;
      contentHeight = 1100 + replyHeight;
      clamp();
      context.handleResize();
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

it("keeps the view still while an edited message is resent", () => {
  const transcript = createTranscript();
  transcript.context.holdViewForRewrite();

  transcript.removeEditedTurn();
  expect(transcript.viewport.scrollTop).toBe(900);

  transcript.arrive();
  expect(transcript.viewport.scrollTop).toBe(900);
  expect(transcript.rewritten.getBoundingClientRect().top).toBe(100);
  // Nothing glides: the new turn is not scrolled to like a fresh send.
  expect(transcript.scrollTo).not.toHaveBeenCalledWith(
    expect.objectContaining({ behavior: "smooth" }),
  );
  expect(transcript.content.style.minHeight).toBe("");

  for (let index = 0; index < 4; index += 1) transcript.stream(50);
  expect(transcript.viewport.scrollTop).toBe(900);
  expect(transcript.rewritten.getBoundingClientRect().top).toBe(100);
  transcript.destroy();
});

it("lets a resend that was not accepted give the view back", () => {
  const transcript = createTranscript();
  transcript.context.holdViewForRewrite();
  expect(transcript.content.style.minHeight).toBe("1400px");

  transcript.context.releaseRewriteHold();
  expect(transcript.content.style.minHeight).toBe("");
  expect(transcript.viewport.scrollTop).toBe(900);
  transcript.destroy();
});
