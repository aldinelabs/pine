import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, it } from "vitest";
import {
  PROJECT_RIGHT_SIDEBAR_STORAGE_KEY,
  useProjectRightSidebarStore,
} from "../projectRightSidebar";

beforeEach(() => {
  window.localStorage.clear();
  setActivePinia(createPinia());
});

it("starts open and toggles open state", () => {
  const store = useProjectRightSidebarStore();

  expect(store.open).toBe(true);
  store.toggle();
  expect(store.open).toBe(false);
  store.setOpen(true);
  expect(store.open).toBe(true);
});

it("remembers the open state across stores", () => {
  useProjectRightSidebarStore().setOpen(false);
  expect(window.localStorage.getItem(PROJECT_RIGHT_SIDEBAR_STORAGE_KEY)).toBe(
    "false",
  );

  setActivePinia(createPinia());
  expect(useProjectRightSidebarStore().open).toBe(false);
});
