import { mount } from "@vue/test-utils";
import { computed, defineComponent, h, provide, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import type { PreviewAnnotation } from "@/stores/previewAnnotations";
import PreviewMediaControls from "../PreviewMediaControls.vue";
import {
  previewAnnotationsKey,
  type AnnotationComposeRequest,
  type AnnotationShape,
} from "../previewRenderer";

function annotation(
  id: string,
  start: number,
  end: number,
  comment = "note",
): PreviewAnnotation {
  return {
    id,
    mode: "rendered",
    anchor: { kind: "time", start, end },
    text: "",
    comment,
    createdAt: 0,
    orphaned: false,
    version: "",
  };
}

const mounted: { unmount: () => void }[] = [];

function render({
  active = true,
  enabled = true,
  annotations = [] as PreviewAnnotation[],
  activeId = undefined as string | undefined,
  draft = undefined as AnnotationShape | undefined,
} = {}) {
  const media = document.createElement("audio");
  Object.defineProperty(media, "duration", { value: 100, configurable: true });
  const play = vi.spyOn(media, "play").mockImplementation(() => {
    Object.defineProperty(media, "paused", {
      value: false,
      configurable: true,
    });
    media.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  const pause = vi.spyOn(media, "pause").mockImplementation(() => {
    Object.defineProperty(media, "paused", { value: true, configurable: true });
    media.dispatchEvent(new Event("pause"));
  });
  const scope = document.createElement("div");
  const input = document.createElement("input");
  document.body.append(scope, input);
  const select = vi.fn();
  const compose = vi.fn<(request: AnnotationComposeRequest) => void>();
  const Host = defineComponent({
    setup() {
      provide(previewAnnotationsKey, {
        annotations: ref(annotations),
        activeId: ref(activeId),
        enabled: computed(() => enabled),
        draft: ref(draft),
        select,
        compose,
      });
      return () =>
        h(PreviewMediaControls, { media, kind: "audio", active, scope });
    },
  });
  const wrapper = mount(Host, {
    global: { plugins: [createAppI18n("en-US")] },
    attachTo: scope,
  });
  mounted.push(wrapper);
  return { wrapper, media, scope, input, play, pause, select, compose };
}

function key(target: EventTarget, name: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: name,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.innerHTML = "";
});

describe("PreviewMediaControls", () => {
  it("shows time comments on the timeline and selects them", async () => {
    const { wrapper, select } = render({
      annotations: [annotation("a", 10, 20, "intro"), annotation("b", 50, 50)],
      activeId: "b",
      draft: { kind: "time", start: 70, end: 80 },
    });
    const spans = wrapper.findAll('[data-slot="media-comment-span"]');
    expect(spans).toHaveLength(2);
    expect(spans[0].attributes("style")).toContain("left: 10%");
    expect(spans[0].attributes("style")).toContain("width: 10%");
    expect(spans[0].attributes("aria-label")).toBe(
      "Comment at 0:10–0:20: intro",
    );
    expect(spans[0].attributes("data-active")).toBeUndefined();
    expect(spans[1].attributes("data-active")).toBe("");
    expect(spans[1].classes()).toContain("bg-annotation");
    const draft = wrapper.get('[data-slot="media-draft-span"]');
    expect(draft.attributes("style")).toContain("left: 70%");

    await spans[0].trigger("click");
    expect(select).toHaveBeenCalledWith("a");
  });

  it("hides comments when commenting is not available", () => {
    const { wrapper } = render({
      enabled: false,
      annotations: [annotation("a", 10, 20)],
    });
    expect(wrapper.find('[data-slot="media-comment-span"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.find('button[aria-label="Comment on this moment"]').exists(),
    ).toBe(false);
  });

  it("comments on the current moment from the Comment button", async () => {
    const { wrapper, media, compose, pause } = render();
    media.currentTime = 42;
    media.dispatchEvent(new Event("timeupdate"));
    await wrapper.vm.$nextTick();
    await wrapper
      .get('button[aria-label="Comment on this moment"]')
      .trigger("click");
    expect(pause).toHaveBeenCalled();
    const request = compose.mock.calls[0][0];
    expect(request.shape).toEqual({ kind: "time", start: 42, end: 42 });
    expect(request.text).toBe("0:42");
    expect(request.rect()).toBeInstanceOf(DOMRect);
  });

  it("comments on a span marked with I and O", async () => {
    const { wrapper, media, compose } = render();
    media.currentTime = 30;
    media.dispatchEvent(new Event("timeupdate"));
    expect(key(document.body, "i").defaultPrevented).toBe(true);
    media.currentTime = 12;
    media.dispatchEvent(new Event("timeupdate"));
    await wrapper.vm.$nextTick();
    expect(
      wrapper.find('button[aria-label="Comment on 0:12–0:30"]').exists(),
    ).toBe(true);
    key(document.body, "o");
    expect(compose.mock.calls[0][0].shape).toEqual({
      kind: "time",
      start: 12,
      end: 30,
    });
    expect(compose.mock.calls[0][0].text).toBe("0:12–0:30");
  });

  it("comments on a span shift-dragged on the timeline", async () => {
    const { wrapper, compose } = render();
    const timeline = wrapper.get('[data-slot="media-timeline"]');
    vi.spyOn(timeline.element, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 100, 200, 20),
    );
    await timeline.trigger("pointerdown", {
      shiftKey: true,
      button: 0,
      clientX: 20,
    });
    await timeline.trigger("pointermove", { clientX: 80 });
    expect(
      wrapper.get('[data-slot="media-draft-span"]').attributes("style"),
    ).toContain("left: 10%");
    await timeline.trigger("pointerup", { clientX: 80 });
    const request = compose.mock.calls[0][0];
    expect(request.shape).toEqual({ kind: "time", start: 10, end: 40 });
    const rect = request.rect();
    expect([rect.x, rect.y, rect.width, rect.height]).toEqual([
      20, 100, 60, 20,
    ]);
  });

  it("plays, seeks and mutes from the keyboard only when the preview is active", () => {
    const { wrapper, media, play, input } = render();
    mounted.pop();
    key(document.body, " ");
    expect(play).toHaveBeenCalledTimes(1);
    media.currentTime = 20;
    key(document.body, "ArrowRight");
    expect(media.currentTime).toBe(25);
    key(document.body, "j");
    expect(media.currentTime).toBe(15);
    key(document.body, "m");
    expect(media.muted).toBe(true);

    expect(key(input, "k").defaultPrevented).toBe(false);
    expect(play).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    const inactive = render({ active: false });
    key(document.body, "k");
    expect(inactive.play).not.toHaveBeenCalled();
  });

  it("leaves Escape alone unless a span is marked", () => {
    render();
    expect(key(document.body, "Escape").defaultPrevented).toBe(false);
    key(document.body, "i");
    expect(key(document.body, "Escape").defaultPrevented).toBe(true);
  });
});
