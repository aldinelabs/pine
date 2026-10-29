import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { defineComponent } from "vue";
import { beforeEach, expect, it, vi } from "vitest";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useWorkbenchStore } from "@/stores/workbench";
import { useWorkbenchEvents } from "../useWorkbenchEvents";

let listener: ((event: unknown) => void) | undefined;

beforeEach(() => {
  window.localStorage.clear();
  setActivePinia(createPinia());
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      respondWorkbenchState: vi.fn(),
      onSessionEvent: vi.fn((next: (event: unknown) => void) => {
        listener = next;
        return () => (listener = undefined);
      }),
    },
  });
});

async function mountListener() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: { template: "<div />" } }],
  });
  await router.push("/");
  return mount(
    defineComponent({
      setup() {
        useWorkbenchEvents();
        return () => null;
      },
    }),
    { global: { plugins: [router] } },
  );
}

it("shows a presented file in its session's preview card", async () => {
  const wrapper = await mountListener();
  const target = { source: "presented" as const, path: "/tmp/report.pdf" };

  listener?.({
    type: "present-file",
    projectId: "p1",
    sessionId: "session-1",
    toolCallId: "call-1",
    path: target.path,
    target,
  });

  expect(useWorkbenchStore().layoutFor("session-1")).toMatchObject({
    open: true,
    bottom: "preview",
    preview: { target, toolCallId: "call-1" },
  });
  expect(useContentTabsStore().presentedTargetFor("call-1")).toEqual(target);
  // The active draft's workbench is untouched.
  expect(useWorkbenchStore().activeLayout.open).toBe(false);
  wrapper.unmount();
  expect(listener).toBeUndefined();
});

it("applies workbench commands to the session that sent them", async () => {
  const wrapper = await mountListener();

  listener?.({
    type: "workbench-command",
    sessionId: "session-2",
    toolCallId: "call-2",
    command: {
      kind: "arrange",
      top: "artifacts",
      bottom: "preview",
      split: 30,
    },
  });

  expect(useWorkbenchStore().layoutFor("session-2")).toMatchObject({
    open: true,
    top: "artifacts",
    bottom: "preview",
    split: 30,
  });
  wrapper.unmount();
});

it("keeps a presented file's line targets and drops malformed ones", async () => {
  const wrapper = await mountListener();
  const target = { source: "presented" as const, path: "/tmp/notes.ts" };

  listener?.({
    type: "present-file",
    projectId: "p1",
    sessionId: "session-1",
    toolCallId: "call-1",
    path: target.path,
    target,
    reveal: {
      line: 12,
      highlights: [
        { start: 12, end: 14 },
        { start: 9, end: 3 },
      ],
    },
  });
  listener?.({
    type: "present-file",
    projectId: "p1",
    sessionId: "session-2",
    toolCallId: "call-2",
    path: target.path,
    target,
    reveal: { line: 0, highlights: [] },
  });

  expect(useWorkbenchStore().layoutFor("session-1").preview).toEqual({
    target,
    toolCallId: "call-1",
    reveal: { line: 12, highlights: [{ start: 12, end: 14 }] },
  });
  expect(useWorkbenchStore().layoutFor("session-2").preview).toEqual({
    target,
    toolCallId: "call-2",
  });
  wrapper.unmount();
});

it("returns the requested conversation's current user layout and visibility", async () => {
  const wrapper = await mountListener();
  const workbench = useWorkbenchStore();
  workbench.setOpen(true);
  workbench.showPanel("top", "files");
  workbench.setSplit(65);
  workbench.setDisplayedOpen(true);
  listener?.({
    type: "workbench-state-request",
    sessionId: "draft",
    requestId: "active-read",
  });
  expect(window.pine.respondWorkbenchState).toHaveBeenLastCalledWith({
    requestId: "active-read",
    state: {
      open: true,
      visible: true,
      top: "files",
      bottom: "preview",
      split: 65,
    },
  });
  workbench.apply("background", {
    kind: "arrange",
    top: "tasks",
    bottom: null,
  });
  listener?.({
    type: "workbench-state-request",
    sessionId: "background",
    requestId: "background-read",
  });
  expect(window.pine.respondWorkbenchState).toHaveBeenLastCalledWith({
    requestId: "background-read",
    state: {
      open: true,
      visible: false,
      top: "tasks",
      bottom: null,
      split: 65,
    },
  });
  wrapper.unmount();
});

it("opens and reuses a full preview tab for the foreground conversation", async () => {
  const tabs = useContentTabsStore();
  tabs.setDraftProject("session-1", "p1");
  tabs.bindSession("session-1", {
    id: "foreground",
    createdAt: "",
    updatedAt: "",
    messageCount: 1,
  });
  const wrapper = await mountListener();
  const reveal = { line: 3, highlights: [{ start: 3, end: 4 }] };
  const event = {
    type: "present-file",
    projectId: "p1",
    sessionId: "foreground",
    toolCallId: "full-call",
    path: "/tmp/report.md",
    target: { source: "presented", path: "/tmp/report.md" },
    display: "fullscreen",
    reveal,
  };
  listener?.(event);
  await flushPromises();
  const tab = tabs.tabs.find((candidate) => candidate.kind === "file");
  expect(tab).toMatchObject({
    source: "presented",
    path: "/tmp/report.md",
    projectId: "p1",
    reveal,
  });
  expect(wrapper.vm.$router.currentRoute.value.query.tab).toBe(tab!.id);
  expect(useWorkbenchStore().layoutFor("foreground").open).toBe(false);
  listener?.(event);
  await flushPromises();
  expect(
    tabs.tabs.filter((candidate) => candidate.kind === "file"),
  ).toHaveLength(1);
  expect(tabs.presentedTargetFor("full-call")).toEqual(event.target);
  wrapper.unmount();
});

it("prepares a background full preview without replacing the active conversation or sidebar", async () => {
  const tabs = useContentTabsStore();
  tabs.setDraftProject("session-1", "p1");
  tabs.bindSession("session-1", {
    id: "foreground",
    createdAt: "",
    updatedAt: "",
    messageCount: 1,
  });
  const wrapper = await mountListener();
  const before = { ...useWorkbenchStore().activeLayout };
  listener?.({
    type: "present-file",
    projectId: "p2",
    sessionId: "background",
    toolCallId: "background-call",
    path: "/tmp/background.pdf",
    target: { source: "presented", path: "/tmp/background.pdf" },
    display: "fullscreen",
  });
  await flushPromises();
  expect(tabs.tabs).toContainEqual(
    expect.objectContaining({
      kind: "file",
      projectId: "p2",
      path: "/tmp/background.pdf",
    }),
  );
  expect(tabs.fallbackActiveTabId).toBe("session-1");
  expect(wrapper.vm.$router.currentRoute.value.query.tab).toBeUndefined();
  expect(useWorkbenchStore().activeLayout).toEqual(before);
  wrapper.unmount();
});
