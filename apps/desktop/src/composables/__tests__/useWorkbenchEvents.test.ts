import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
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

function mountListener() {
  return mount(
    defineComponent({
      setup() {
        useWorkbenchEvents();
        return () => null;
      },
    }),
  );
}

it("shows a presented file in its session's preview card", () => {
  const wrapper = mountListener();
  const target = { source: "presented" as const, path: "/tmp/report.pdf" };

  listener?.({
    type: "present-file",
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

it("applies workbench commands to the session that sent them", () => {
  const wrapper = mountListener();

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

it("keeps a presented file's line targets and drops malformed ones", () => {
  const wrapper = mountListener();
  const target = { source: "presented" as const, path: "/tmp/notes.ts" };

  listener?.({
    type: "present-file",
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

it("returns the requested conversation's current user layout and visibility", () => {
  const wrapper = mountListener();
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
