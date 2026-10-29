import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { useWorkbenchStore } from "@/stores/workbench";
import ProjectWorkbench from "../ProjectWorkbench.vue";

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  setActivePinia(createPinia());
  HTMLElement.prototype.setPointerCapture = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

function mountWorkbench() {
  return mount(ProjectWorkbench, {
    global: {
      plugins: [createAppI18n("en-US")],
      stubs: {
        Sidebar: { template: "<div><slot /></div>" },
        WorkbenchResizeHandle: true,
        WorkbenchVersion: true,
        WorkbenchCard: {
          props: ["panel", "position"],
          template:
            '<div data-testid="card" :data-panel="panel" :data-position="position" />',
        },
      },
    },
  });
}

/** Lets the stack's double animation frame and card transition run. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(600);
  await flushPromises();
}

function items(wrapper: ReturnType<typeof mountWorkbench>) {
  return wrapper.findAll("[data-testid=workbench-stack-item]").map((item) => ({
    element: item.element,
    panel: item.get("[data-testid=card]").attributes("data-panel"),
    order: Number((item.element as HTMLElement).style.order),
    grow: Number((item.element as HTMLElement).style.flexGrow),
    inert: item.attributes("inert") !== undefined,
  }));
}

it("shrinks a closed top card while the card below grows into its place", async () => {
  const store = useWorkbenchStore();
  store.setOpen(true);
  const wrapper = mountWorkbench();
  await settle();
  const [top, bottom] = items(wrapper);
  expect(top).toMatchObject({ panel: "artifacts", grow: 50 });
  expect(bottom).toMatchObject({ panel: "preview", grow: 50 });

  store.closeCard("artifacts");
  await flushPromises();
  const [closing, rising] = items(wrapper);
  // The same elements stay; the closing card keeps its place above.
  expect(closing).toMatchObject({ panel: "artifacts", grow: 0, inert: true });
  expect(rising).toMatchObject({ panel: "preview", grow: 100, inert: false });
  expect(closing.order).toBeLessThan(rising.order);
  expect(rising.element).toBe(bottom.element);

  await settle();
  expect(items(wrapper)).toEqual([
    expect.objectContaining({ panel: "preview", element: bottom.element }),
  ]);
});

it("grows a new card in below the single card", async () => {
  const store = useWorkbenchStore();
  store.setOpen(true);
  store.closeCard("preview");
  const wrapper = mountWorkbench();
  await settle();

  store.showPanel("bottom", "files");
  await flushPromises();
  expect(items(wrapper)).toEqual([
    expect.objectContaining({ panel: "artifacts", grow: 100 }),
    expect.objectContaining({ panel: "files", grow: 0 }),
  ]);
  await settle();
  expect(items(wrapper)).toEqual([
    expect.objectContaining({ panel: "artifacts", grow: 50 }),
    expect.objectContaining({ panel: "files", grow: 50 }),
  ]);
});

it("resizes the cards by dragging or with the keyboard", async () => {
  const store = useWorkbenchStore();
  store.setOpen(true);
  const wrapper = mountWorkbench();
  await settle();
  const stack = wrapper.get("[data-testid=workbench-divider]").element
    .parentElement!;
  vi.spyOn(stack, "getBoundingClientRect").mockReturnValue({
    height: 500,
  } as DOMRect);
  const divider = wrapper.get("[data-testid=workbench-divider]");

  await divider.trigger("pointerdown", { button: 0, clientY: 200 });
  await divider.trigger("pointermove", { clientY: 300 });
  expect(store.activeLayout.split).toBe(70);
  await divider.trigger("pointerup");

  await divider.trigger("keydown", { key: "ArrowUp" });
  expect(store.activeLayout.split).toBe(65);
  await divider.trigger("keydown", { key: "End" });
  expect(store.activeLayout.split).toBe(80);
});

it("slides swapped cards past each other instead of jumping", async () => {
  const store = useWorkbenchStore();
  store.setOpen(true);
  store.setSplit(40);
  const wrapper = mountWorkbench();
  await settle();
  const [top, bottom] = items(wrapper);
  const rects = new Map<Element, Partial<DOMRect>>([
    [top.element, { top: 0, height: 200 }],
    [bottom.element, { top: 212, height: 300 }],
    [wrapper.get("[data-testid=workbench-divider]").element, { height: 12 }],
  ]);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return {
        top: 0,
        height: this.dataset.testid === undefined ? 512 : 0,
        ...rects.get(this),
      } as DOMRect;
    },
  );
  const animate = vi.fn();
  HTMLElement.prototype.animate = animate;

  store.showPanel("top", "preview");
  await flushPromises();

  // Neither card remounts or moves in the DOM; their order flips.
  expect(items(wrapper)).toEqual([
    expect.objectContaining({
      element: top.element,
      panel: "artifacts",
      order: 30,
    }),
    expect.objectContaining({
      element: bottom.element,
      panel: "preview",
      order: 10,
    }),
  ]);
  const frames = new Map(
    animate.mock.contexts.map((element, index) => [
      element,
      animate.mock.calls[index][0],
    ]),
  );
  // Each starts where it was: the preview, laid out at the top, starts 212px
  // down; the artifacts, laid out below the preview's 300px, start 312px up.
  expect(frames.get(bottom.element)).toEqual([
    expect.objectContaining({
      flexBasis: "300px",
      transform: "translateY(212px)",
    }),
    expect.objectContaining({ flexBasis: "200px", transform: "translateY(0)" }),
  ]);
  expect(frames.get(top.element)).toEqual([
    expect.objectContaining({
      flexBasis: "200px",
      transform: "translateY(-312px)",
    }),
    expect.objectContaining({ flexBasis: "300px", transform: "translateY(0)" }),
  ]);
});
