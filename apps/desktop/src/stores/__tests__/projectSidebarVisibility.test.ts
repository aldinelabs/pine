import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, it } from "vitest";
import {
  PROJECT_SIDEBAR_VISIBILITY_STORAGE_KEY,
  useProjectSidebarVisibilityStore,
} from "../projectSidebarVisibility";

beforeEach(() => {
  window.localStorage.clear();
  setActivePinia(createPinia());
});

it("starts open and toggles open state", () => {
  const store = useProjectSidebarVisibilityStore();

  expect(store.open).toBe(true);
  store.toggle();
  expect(store.open).toBe(false);
  store.setOpen(true);
  expect(store.open).toBe(true);
});

it("remembers the open state across stores", () => {
  useProjectSidebarVisibilityStore().setOpen(false);
  expect(
    window.localStorage.getItem(PROJECT_SIDEBAR_VISIBILITY_STORAGE_KEY),
  ).toBe("false");

  setActivePinia(createPinia());
  expect(useProjectSidebarVisibilityStore().open).toBe(false);
});
