import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, it } from "vitest";
import {
  DRAFT_WORKBENCH_KEY,
  WORKBENCH_STORAGE_KEY,
  useWorkbenchStore,
} from "../workbench";

beforeEach(() => {
  window.localStorage.clear();
  setActivePinia(createPinia());
});

it("starts closed and toggles the active session's workbench", () => {
  const store = useWorkbenchStore();

  expect(store.activeKey).toBe(DRAFT_WORKBENCH_KEY);
  expect(store.activeLayout.open).toBe(false);
  store.toggle();
  expect(store.activeLayout).toMatchObject({
    open: true,
    top: "artifacts",
    bottom: "todos",
  });
});

it("keeps each session's layout apart and lets new sessions inherit the draft's", () => {
  const store = useWorkbenchStore();
  store.apply(DRAFT_WORKBENCH_KEY, {
    kind: "arrange",
    top: "tasks",
    bottom: null,
  });
  store.apply("session-1", { kind: "open", panel: "preview", position: "top" });

  expect(store.layoutFor("session-1")).toMatchObject({
    open: true,
    top: "preview",
    bottom: null,
  });
  expect(store.layoutFor("session-2")).toMatchObject({
    open: true,
    top: "tasks",
  });
  expect(store.layoutFor(DRAFT_WORKBENCH_KEY).top).toBe("tasks");
});

it("remembers layouts across stores without the drag-only rearrangement bump", () => {
  const store = useWorkbenchStore();
  store.setOpen(true);
  const arranged = store.arrangement;
  store.setSplit(65);
  expect(store.arrangement).toBe(arranged);
  expect(
    JSON.parse(window.localStorage.getItem(WORKBENCH_STORAGE_KEY) ?? "{}"),
  ).toMatchObject({ [DRAFT_WORKBENCH_KEY]: { open: true, split: 65 } });

  setActivePinia(createPinia());
  expect(useWorkbenchStore().activeLayout).toMatchObject({
    open: true,
    split: 65,
  });
});

it("ignores corrupt storage", () => {
  window.localStorage.setItem(WORKBENCH_STORAGE_KEY, "{not json");
  expect(useWorkbenchStore().activeLayout.open).toBe(false);
});
