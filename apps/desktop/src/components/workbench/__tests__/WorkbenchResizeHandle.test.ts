import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import {
  WORKBENCH_WIDTH_STORAGE_KEY,
  useWorkbenchStore,
} from "@/stores/workbench";
import WorkbenchResizeHandle from "../WorkbenchResizeHandle.vue";

beforeEach(() => {
  window.localStorage.clear();
  setActivePinia(createPinia());
  HTMLElement.prototype.setPointerCapture = vi.fn();
});

afterEach(() => {
  document.body.innerHTML = "";
});

function mountHandle() {
  return mount(WorkbenchResizeHandle, {
    attachTo: document.body,
    global: { plugins: [createAppI18n("en-US")] },
  });
}

it("widens the column when dragged towards the conversation", async () => {
  const store = useWorkbenchStore();
  const handle = mountHandle().get("[data-testid=workbench-resize-handle]");

  await handle.trigger("pointerdown", { button: 0, clientX: 800 });
  expect(store.isResizing).toBe(true);
  await handle.trigger("pointermove", { clientX: 700 });
  expect(store.width).toBe(500);
  await handle.trigger("pointermove", { clientX: 1000 });
  expect(store.width).toBe(320);
  await handle.trigger("pointerup");

  expect(store.isResizing).toBe(false);
  expect(window.localStorage.getItem(WORKBENCH_WIDTH_STORAGE_KEY)).toBe("320");
});

it("keeps the conversation readable while widening", async () => {
  const inset = document.createElement("div");
  inset.dataset.slot = "sidebar-inset";
  Object.defineProperty(inset, "offsetWidth", { value: 560 });
  document.body.append(inset);
  const store = useWorkbenchStore();
  const handle = mountHandle().get("[data-testid=workbench-resize-handle]");

  await handle.trigger("pointerdown", { button: 0, clientX: 800 });
  await handle.trigger("pointermove", { clientX: 400 });

  // 400 + 560 - 480: the conversation keeps its minimum width.
  expect(store.width).toBe(480);
});

it("resets on double-click and steps with the arrow keys", async () => {
  const store = useWorkbenchStore();
  store.setWidth(600);
  const handle = mountHandle().get("[data-testid=workbench-resize-handle]");

  await handle.trigger("dblclick");
  expect(store.width).toBe(400);
  await handle.trigger("keydown", { key: "ArrowLeft" });
  expect(store.width).toBe(416);
  await handle.trigger("keydown", { key: "ArrowRight" });
  expect(store.width).toBe(400);
});
