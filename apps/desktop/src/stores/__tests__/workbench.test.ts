import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { watch } from "vue";
import {
  assistantLayout,
  DRAFT_WORKBENCH_KEY,
  WORKBENCH_STORAGE_KEY,
  WORKBENCH_WIDTH_STORAGE_KEY,
  useWorkbenchStore,
} from "../workbench";
import { useSessionStore } from "../session";
import type { PineSessionSummary } from "@/shared/sessions";

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
    bottom: "preview",
  });
});

it("keeps each session's layout apart and lets new sessions inherit the draft's", () => {
  const store = useWorkbenchStore();
  store.apply(DRAFT_WORKBENCH_KEY, {
    kind: "arrange",
    top: "preview",
    bottom: null,
  });
  store.apply("session-1", {
    kind: "open",
    panel: "artifacts",
    position: "top",
  });

  expect(store.layoutFor("session-1")).toMatchObject({
    open: true,
    top: "artifacts",
    bottom: null,
  });
  expect(store.layoutFor("session-2")).toMatchObject({
    open: true,
    top: "preview",
  });
  expect(store.layoutFor(DRAFT_WORKBENCH_KEY).top).toBe("preview");
});

it("starts a new conversation from the layout of the session it leaves", () => {
  const store = useWorkbenchStore();
  const sessionStore = useSessionStore();
  store.apply("session-1", {
    kind: "arrange",
    top: "tasks",
    bottom: "preview",
  });
  store.present("session-1", {
    target: { source: "presented", path: "/tmp/report.pdf" },
  });

  sessionStore.activeSession = { id: "session-1" } as PineSessionSummary;
  store.setSplit(70);
  sessionStore.activeSession = null;

  expect(store.activeKey).toBe(DRAFT_WORKBENCH_KEY);
  expect(store.activeLayout).toMatchObject({
    open: true,
    top: "tasks",
    bottom: "preview",
    split: 70,
    preview: null,
  });
});

it("remembers layouts across stores", () => {
  const store = useWorkbenchStore();
  store.setOpen(true);
  store.setSplit(65);
  expect(
    JSON.parse(window.localStorage.getItem(WORKBENCH_STORAGE_KEY) ?? "{}"),
  ).toMatchObject({ [DRAFT_WORKBENCH_KEY]: { open: true, split: 65 } });

  setActivePinia(createPinia());
  expect(useWorkbenchStore().activeLayout).toMatchObject({
    open: true,
    split: 65,
  });
});

it("stores a dragged split once the drag ends", () => {
  const store = useWorkbenchStore();
  store.setOpen(true);
  const stored = () =>
    JSON.parse(window.localStorage.getItem(WORKBENCH_STORAGE_KEY) ?? "{}")[
      DRAFT_WORKBENCH_KEY
    ]?.split;
  const before = stored();

  store.setSplit(40, { persist: false });
  store.setSplit(45, { persist: false });
  expect(store.activeLayout.split).toBe(45);
  expect(stored()).toBe(before);

  store.saveSplit();
  expect(stored()).toBe(45);

  setActivePinia(createPinia());
  expect(useWorkbenchStore().activeLayout.split).toBe(45);
});

it("ignores corrupt storage", () => {
  window.localStorage.setItem(WORKBENCH_STORAGE_KEY, "{not json");
  expect(useWorkbenchStore().activeLayout.open).toBe(false);
});

it("shares one clamped width and stores it when a drag ends", () => {
  const store = useWorkbenchStore();
  expect(store.width).toBe(400);

  store.setResizing(true);
  store.setWidth(512.4);
  store.setWidth(9999);
  expect(store.width).toBe(720);
  expect(window.localStorage.getItem(WORKBENCH_WIDTH_STORAGE_KEY)).toBeNull();
  store.setWidth(512);
  store.setResizing(false);
  expect(store.isResizing).toBe(false);

  setActivePinia(createPinia());
  expect(useWorkbenchStore().width).toBe(512);
});

it("falls back to the default width for a stored non-number", () => {
  window.localStorage.setItem(WORKBENCH_WIDTH_STORAGE_KEY, "wide");
  expect(useWorkbenchStore().width).toBe(400);
});

it("highlights a card until the user reaches it or it leaves", () => {
  const store = useWorkbenchStore();
  store.apply(DRAFT_WORKBENCH_KEY, {
    kind: "arrange",
    top: "artifacts",
    bottom: "tasks",
    highlight: "tasks",
  });
  // Every card the agent brings into view pulses, not only the named one.
  expect(store.isHighlighted("tasks")).toBe(true);
  expect(store.isHighlighted("artifacts")).toBe(true);

  store.acknowledge("artifacts");
  store.acknowledge("tasks");
  expect(store.isHighlighted("tasks")).toBe(false);

  store.apply(DRAFT_WORKBENCH_KEY, {
    kind: "open",
    panel: "tasks",
    highlight: true,
  });
  expect(store.isHighlighted("tasks")).toBe(true);
  store.closeCard("tasks");
  expect(store.isHighlighted("tasks")).toBe(false);
  // Reopening the card does not bring back a dropped highlight.
  store.showPanel("bottom", "tasks");
  expect(store.isHighlighted("tasks")).toBe(false);
});

it("keeps a background session's highlight for when it becomes active", () => {
  const store = useWorkbenchStore();
  store.apply("session-1", { kind: "open", panel: "preview", highlight: true });

  expect(store.isHighlighted("preview")).toBe(false);
  expect(
    JSON.stringify(
      JSON.parse(window.localStorage.getItem(WORKBENCH_STORAGE_KEY) ?? "{}"),
    ),
  ).not.toContain("highlight");
});

it("empties the preview card but keeps it in place", () => {
  const store = useWorkbenchStore();
  store.preview({ target: { source: "presented", path: "/tmp/report.pdf" } });
  expect(store.panelPosition("preview")).toBe("bottom");

  store.clearPreview();
  expect(store.activeLayout).toMatchObject({
    open: true,
    bottom: "preview",
    preview: null,
  });
});

it("moves a side chat below up when the card above it closes", () => {
  const store = useWorkbenchStore();
  store.showPanel("top", "artifacts");
  store.showPanel("bottom", "side-chat");

  store.closeCard("artifacts");

  expect(store.activeLayout).toMatchObject({
    open: true,
    top: "side-chat",
    bottom: null,
  });
});

it("never keeps the side chat as the card to reopen", () => {
  const store = useWorkbenchStore();
  store.showSideChat();
  expect(store.activeLayout).toMatchObject({ open: true, top: "side-chat" });

  store.closeCard("side-chat");

  expect(store.activeLayout.open).toBe(false);
  expect(store.activeLayout.top).not.toBe("side-chat");
});

it("starts a new conversation without the side chat of the one it leaves", () => {
  const store = useWorkbenchStore();
  const sessionStore = useSessionStore();
  sessionStore.activeSession = { id: "session-1" } as PineSessionSummary;
  store.showPanel("top", "artifacts");
  store.showSideChat();
  expect(store.activeLayout).toMatchObject({
    top: "side-chat",
    bottom: "artifacts",
  });

  sessionStore.activeSession = null;
  expect(store.activeLayout).toMatchObject({
    open: true,
    top: "artifacts",
    bottom: null,
  });

  sessionStore.activeSession = { id: "session-2" } as PineSessionSummary;
  store.closeCard("artifacts");
  store.showSideChat();
  sessionStore.activeSession = null;
  expect(store.activeLayout.open).toBe(true);
  expect(store.activeLayout.top).not.toBe("side-chat");
});

it("shows a file tab's details and comments, closed until asked for", () => {
  const store = useWorkbenchStore();
  store.toggle();
  const sessionLayout = store.activeLayout;

  store.showFile("file-1", { comments: true, commentCount: 2 });
  expect(store.activeKey).toBe("file:file-1");
  expect(store.activeLayout).toMatchObject({
    open: false,
    top: "file-comments",
    bottom: "file-details",
  });

  store.toggle();
  expect(store.isFileOpen("file-1")).toBe(true);
  store.setSplit(30);
  expect(store.activeLayout).toMatchObject({ open: true, split: 30 });
  // Closing either card hides both.
  store.closeCard("file-comments");
  expect(store.activeLayout.open).toBe(false);

  store.showFile("file-2", { comments: false, commentCount: 0 });
  expect(store.activeLayout).toMatchObject({
    open: false,
    top: "file-details",
    bottom: null,
  });

  // Leaving the file tabs brings the session's own cards back, untouched.
  store.showFile("file-1", undefined);
  expect(store.activeKey).toBe("file:file-2");
  store.showFile("file-2", undefined);
  expect(store.activeLayout).toEqual(sessionLayout);
  expect(window.localStorage.getItem(WORKBENCH_STORAGE_KEY)).not.toContain(
    "file:",
  );

  store.setFileOpen("file-1", true);
  store.forgetFile("file-1");
  expect(store.isFileOpen("file-1")).toBe(false);
});

it("keeps a file tab's column while the next session tab resumes", () => {
  const store = useWorkbenchStore();
  const sessionStore = useSessionStore();
  store.setOpen(true, "session-a");
  sessionStore.activeSession = { id: "session-a" } as PineSessionSummary;
  store.setFrontSession("session-a");

  // Session A opens an attachment's full preview in a file tab.
  store.setFrontSession(undefined);
  store.showFile("file-1", { comments: false, commentCount: 0 });
  expect(store.activeLayout.open).toBe(false);

  const opened: boolean[] = [];
  const stop = watch(
    () => store.activeLayout.open,
    (open) => opened.push(open),
    { flush: "sync" },
  );
  // Session B's tab comes to the front; the file tab leaves it before the
  // session store has resumed B.
  store.setFrontSession("session-b");
  store.showFile("file-1", undefined);
  expect(store.activeLayout.open).toBe(false);
  sessionStore.activeSession = { id: "session-b" } as PineSessionSummary;
  stop();

  expect(store.activeKey).toBe("session-b");
  expect(opened).toEqual([]);
});

it("returns from a file tab to its own session's column", () => {
  const store = useWorkbenchStore();
  const sessionStore = useSessionStore();
  store.setOpen(true, "session-a");
  sessionStore.activeSession = { id: "session-a" } as PineSessionSummary;
  store.setFrontSession(undefined);
  store.showFile("file-1", { comments: false, commentCount: 0 });

  store.setFrontSession("session-a");
  store.showFile("file-1", undefined);
  expect(store.activeKey).toBe("session-a");
  expect(store.activeLayout.open).toBe(true);

  // A later switch between session tabs waits on the session as before.
  store.setFrontSession("session-b");
  expect(store.activeKey).toBe("session-a");
});

it("keeps the column closed while no tab is open", () => {
  const store = useWorkbenchStore();
  const sessionStore = useSessionStore();
  store.setOpen(true, "session-a");
  store.setOpen(false, "session-b");
  sessionStore.activeSession = { id: "session-a" } as PineSessionSummary;
  store.setFrontSession("session-a");
  expect(store.activeLayout.open).toBe(true);

  const opened: boolean[] = [];
  const stop = watch(
    () => store.activeLayout.open,
    (open) => opened.push(open),
    { flush: "sync" },
  );
  // The last tab closes: the column closes and cannot be toggled open.
  store.setFrontSession(null);
  expect(store.isTabless).toBe(true);
  store.toggle();
  expect(store.activeLayout.open).toBe(false);
  expect(store.layoutFor("session-a").open).toBe(true);

  // Session B's tab opens before the session store has resumed it.
  store.setFrontSession("session-b");
  expect(store.activeLayout.open).toBe(false);
  sessionStore.activeSession = { id: "session-b" } as PineSessionSummary;
  stop();

  expect(opened).toEqual([false]);
  expect(store.isTabless).toBe(false);
});

it("restores a tab's own column when it reopens from no tabs", () => {
  const store = useWorkbenchStore();
  const sessionStore = useSessionStore();
  store.setOpen(true, "session-a");
  sessionStore.activeSession = { id: "session-a" } as PineSessionSummary;
  store.setFrontSession(null);
  expect(store.activeLayout.open).toBe(false);

  store.setFrontSession("session-a");
  expect(store.activeLayout.open).toBe(true);

  // Later switches between session tabs are not held closed.
  store.setFrontSession("session-b");
  expect(store.activeLayout.open).toBe(true);
});

describe("the Assistant's workbench", () => {
  it("leaves out files and artifacts, showing Tasks when nothing is left", () => {
    const base = { open: true, split: 50, preview: null };
    expect(
      assistantLayout({ ...base, top: "artifacts", bottom: "preview" }),
    ).toEqual({ ...base, top: "preview", bottom: null });
    expect(assistantLayout({ ...base, top: "files", bottom: null })).toEqual({
      ...base,
      top: "tasks",
      bottom: null,
    });
    expect(
      assistantLayout({ ...base, top: "tasks", bottom: "preview" }),
    ).toEqual({ ...base, top: "tasks", bottom: "preview" });
  });
});
