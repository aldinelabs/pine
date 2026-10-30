import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TEMPORARY_WORKSPACE_PROJECT_ID } from "@/shared/projects";
import type { QuickComposerHandoff } from "@/shared/quickComposer";
import { useContentTabsStore } from "../contentTabs";
import { PROJECT_SIDEBAR_VISIBILITY_STORAGE_KEY } from "../projectSidebarVisibility";
import { useProjectSidebarVisibilityStore } from "../projectSidebarVisibility";
import { useQuickComposerHandoffStore } from "../quickComposerHandoff";
import { WORKBENCH_STORAGE_KEY, useWorkbenchStore } from "../workbench";
import { DEFAULT_WORKBENCH_LAYOUT } from "@/lib/workbenchLayout";

const handoff: QuickComposerHandoff = {
  message: "Hello",
  approvalMode: "auto-approve",
  projectId: TEMPORARY_WORKSPACE_PROJECT_ID,
  context: [],
};
let resolveHandoff: (handoff: QuickComposerHandoff | null) => void;

beforeEach(() => {
  vi.stubGlobal("pine", {
    isQuickComposerHandoff: true,
    takeQuickComposerHandoff: vi.fn(
      () =>
        new Promise<QuickComposerHandoff | null>(
          (resolve) => (resolveHandoff = resolve),
        ),
    ),
  });
  setActivePinia(createPinia());
});

afterEach(() => vi.unstubAllGlobals());

it("waits for the message once and hands it over once", async () => {
  const store = useQuickComposerHandoffStore();
  store.initialize();
  store.initialize();
  expect(window.pine.takeQuickComposerHandoff).toHaveBeenCalledOnce();
  expect(store.take()).toBeNull();

  resolveHandoff(handoff);
  await Promise.resolve();
  expect(store.pending).toEqual(handoff);
  expect(store.take()).toEqual(handoff);
  expect(store.take()).toBeNull();
});

it("opens a fresh draft with both sidebars collapsed, remembering nothing", () => {
  window.localStorage.setItem(PROJECT_SIDEBAR_VISIBILITY_STORAGE_KEY, "true");
  window.localStorage.setItem(
    WORKBENCH_STORAGE_KEY,
    JSON.stringify({ draft: { ...DEFAULT_WORKBENCH_LAYOUT, open: true } }),
  );
  window.localStorage.setItem("pine.last-draft-project", "project-a");
  window.localStorage.setItem(
    "pine.content-tabs.v2",
    JSON.stringify({
      activeTabId: "session-9",
      tabs: [
        { id: "session-9", kind: "session", state: "draft", projectId: "x" },
      ],
    }),
  );

  expect(useProjectSidebarVisibilityStore().open).toBe(false);
  expect(useWorkbenchStore().activeLayout.open).toBe(false);
  expect(useContentTabsStore().tabs).toEqual([
    {
      id: "session-1",
      kind: "session",
      state: "draft",
      projectId: TEMPORARY_WORKSPACE_PROJECT_ID,
    },
  ]);
  expect(
    window.localStorage.getItem(PROJECT_SIDEBAR_VISIBILITY_STORAGE_KEY),
  ).toBe("true");
});

it("leaves other windows alone", () => {
  vi.stubGlobal("pine", { isQuickComposerHandoff: false });
  const store = useQuickComposerHandoffStore();
  store.initialize();
  expect(store.pending).toBeNull();
  expect(useProjectSidebarVisibilityStore().open).toBe(true);
});
