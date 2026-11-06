import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, ref, type Ref } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  WORKBENCH_WIDTH_STORAGE_KEY,
  useWorkbenchStore,
} from "@/stores/workbench";
import { useWorkbenchWindowResize } from "../useWorkbenchWindowResize";

const media = vi.hoisted(() => ({
  mobile: undefined as unknown as Ref<boolean>,
}));
vi.mock("@vueuse/core", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useMediaQuery: () => media.mobile,
}));

const originalWidth = Object.getOwnPropertyDescriptor(window, "innerWidth")!;
const wrappers: ReturnType<typeof mount>[] = [];

function resize(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  window.dispatchEvent(new Event("resize"));
}

function mountResize(enabled = ref(true)) {
  let state!: ReturnType<typeof useWorkbenchWindowResize>;
  const wrapper = mount(
    defineComponent({
      setup() {
        state = useWorkbenchWindowResize(enabled);
        return () => null;
      },
    }),
  );
  wrappers.push(wrapper);
  return { enabled, state, wrapper };
}

beforeEach(() => {
  vi.useFakeTimers();
  media.mobile = ref(false);
  resize(1400);
  setActivePinia(createPinia());
  const store = useWorkbenchStore();
  store.setOpen(true);
  store.setDisplayedOpen(true);
});

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  Object.defineProperty(window, "innerWidth", originalWidth);
  vi.useRealTimers();
});

it("gives window width changes to the workbench before the conversation", () => {
  const store = useWorkbenchStore();
  mountResize();

  resize(1360);
  expect(store.width).toBe(360);
  expect(window.innerWidth - store.width).toBe(1000);
  resize(1500);
  expect(store.width).toBe(500);
  expect(window.innerWidth - store.width).toBe(1000);
});

it("restores the original layout after passing either width limit", () => {
  const store = useWorkbenchStore();
  mountResize();

  resize(1100);
  expect(store.width).toBe(320);
  resize(1400);
  expect(store.width).toBe(400);
  resize(1900);
  expect(store.width).toBe(720);
  resize(1400);
  expect(store.width).toBe(400);
});

it("does not animate intermediate widths and saves once resizing settles", async () => {
  const store = useWorkbenchStore();
  const { state } = mountResize();
  const save = vi.spyOn(store, "saveWidth");

  resize(1460);
  resize(1500);
  expect(state.isResizing.value).toBe(true);
  expect(save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(150);

  expect(state.isResizing.value).toBe(false);
  expect(save).toHaveBeenCalledOnce();
  expect(window.localStorage.getItem(WORKBENCH_WIDTH_STORAGE_KEY)).toBe("500");
});

it("ignores height-only changes", () => {
  const store = useWorkbenchStore();
  const { state } = mountResize();
  const save = vi.spyOn(store, "saveWidth");
  resize(1400);
  expect(store.width).toBe(400);
  expect(state.isResizing.value).toBe(false);
  expect(save).not.toHaveBeenCalled();
});

it("leaves app-driven window animations alone and rebases afterward", () => {
  const store = useWorkbenchStore();
  const { enabled } = mountResize();

  enabled.value = false;
  resize(1656);
  expect(store.width).toBe(400);
  enabled.value = true;
  resize(1616);
  expect(store.width).toBe(360);
});

it("keeps closed and closing workbenches unchanged", () => {
  const store = useWorkbenchStore();
  mountResize();
  store.setClosing(true);
  resize(1300);
  expect(store.width).toBe(400);
  store.setClosing(false);
  store.setOpen(false);
  store.setDisplayedOpen(false);
  resize(1500);
  expect(store.width).toBe(400);

  store.setOpen(true);
  store.setDisplayedOpen(true);
  resize(1550);
  expect(store.width).toBe(450);
});

it("rebases after an explicit divider drag or keyboard adjustment", () => {
  const store = useWorkbenchStore();
  mountResize();
  store.setResizing(true);
  store.setWidth(560);
  resize(1500);
  expect(store.width).toBe(560);
  store.setResizing(false);
  resize(1450);
  expect(store.width).toBe(510);

  store.setWidth(480);
  resize(1500);
  expect(store.width).toBe(530);
});

it("does not change sheet widths when entering or leaving a mobile layout", () => {
  const store = useWorkbenchStore();
  mountResize();
  media.mobile.value = true;
  resize(600);
  resize(700);
  expect(store.width).toBe(400);
  resize(1400);
  media.mobile.value = false;
  resize(1360);
  expect(store.width).toBe(360);
});

it("ignores the resize event before the mobile media query catches up", () => {
  const store = useWorkbenchStore();
  mountResize();
  resize(700);
  expect(store.width).toBe(400);
});

it("saves a pending width when the workbench closes", async () => {
  const store = useWorkbenchStore();
  const { state } = mountResize();
  resize(1500);
  store.setOpen(false);
  expect(state.isResizing.value).toBe(false);
  expect(window.localStorage.getItem(WORKBENCH_WIDTH_STORAGE_KEY)).toBe("500");
  const save = vi.spyOn(store, "saveWidth");
  await vi.advanceTimersByTimeAsync(150);
  expect(save).not.toHaveBeenCalled();
});

it("cleans up its listener and settle timer on unmount", async () => {
  const store = useWorkbenchStore();
  const { wrapper } = mountResize();
  resize(1500);
  wrapper.unmount();
  const save = vi.spyOn(store, "saveWidth");
  resize(1450);
  await vi.advanceTimersByTimeAsync(150);
  expect(store.width).toBe(500);
  expect(save).not.toHaveBeenCalled();
});
