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
  expect(top).toMatchObject({ panel: "artifacts", grow: 40 });
  expect(bottom).toMatchObject({ panel: "preview", grow: 60 });

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
    expect.objectContaining({ panel: "artifacts", grow: 40 }),
    expect.objectContaining({ panel: "files", grow: 60 }),
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
  expect(store.activeLayout.split).toBe(60);
  await divider.trigger("pointerup");

  await divider.trigger("keydown", { key: "ArrowUp" });
  expect(store.activeLayout.split).toBe(55);
  await divider.trigger("keydown", { key: "End" });
  expect(store.activeLayout.split).toBe(80);
});
