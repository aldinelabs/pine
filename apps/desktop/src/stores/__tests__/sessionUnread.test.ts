import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import type { PineAgentEvent } from "@/shared/agent";
import { useSessionStore } from "../session";
import {
  MAX_UNREAD_SESSIONS,
  SESSION_UNREAD_STORAGE_KEY,
  useSessionUnreadStore,
} from "../sessionUnread";

let focused = true;

beforeEach(() => {
  localStorage.clear();
  focused = true;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.restoreAllMocks();
});

function stored(): unknown {
  return JSON.parse(localStorage.getItem(SESSION_UNREAD_STORAGE_KEY) ?? "null");
}

describe("session unread marks", () => {
  it("marks and reads sessions, and keeps them across a restart", () => {
    const store = useSessionUnreadStore();
    store.markUnread("s1");
    store.markUnread("s2");
    store.markUnread("s2");
    expect(store.isUnread("s1")).toBe(true);
    expect(stored()).toEqual(["s1", "s2"]);

    store.markRead("s1");
    expect(store.isUnread("s1")).toBe(false);

    setActivePinia(createPinia());
    const restarted = useSessionUnreadStore();
    expect(restarted.isUnread("s1")).toBe(false);
    expect(restarted.isUnread("s2")).toBe(true);
  });

  it("ignores corrupt storage and drops the oldest marks past the cap", () => {
    localStorage.setItem(SESSION_UNREAD_STORAGE_KEY, "{not json");
    const store = useSessionUnreadStore();
    expect(store.unreadIds.size).toBe(0);

    for (let index = 0; index <= MAX_UNREAD_SESSIONS; index += 1)
      store.markUnread(`s${index}`);
    expect(store.unreadIds.size).toBe(MAX_UNREAD_SESSIONS);
    expect(store.isUnread("s0")).toBe(false);
    expect(store.isUnread(`s${MAX_UNREAD_SESSIONS}`)).toBe(true);
  });

  it("leaves a finished run read only when the user is looking at it", () => {
    const store = useSessionUnreadStore();
    store.noteRunFinished("shown", "shown");
    expect(store.isUnread("shown")).toBe(false);

    store.noteRunFinished("other", "shown");
    expect(store.isUnread("other")).toBe(true);

    focused = false;
    store.noteRunFinished("shown", "shown");
    expect(store.isUnread("shown")).toBe(true);
  });

  it("reads the shown session once its window is focused", async () => {
    const store = useSessionUnreadStore();
    store.markUnread("s1");
    store.markUnread("s2");
    focused = false;
    const shown = ref<string | null>("s1");
    const scope = effectScope();
    scope.run(() => store.trackReading(shown));
    await nextTick();
    expect(store.isUnread("s1")).toBe(true);

    focused = true;
    window.dispatchEvent(new Event("focus"));
    await nextTick();
    expect(store.isUnread("s1")).toBe(false);

    shown.value = "s2";
    await nextTick();
    expect(store.isUnread("s2")).toBe(false);
    scope.stop();
  });

  it("marks a session whose run ends in the background", () => {
    let listener: ((event: PineAgentEvent) => void) | undefined;
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        onSessionEvent: vi.fn((callback) => {
          listener = callback;
          return () => undefined;
        }),
      },
    });
    const sessions = useSessionStore();
    const unread = useSessionUnreadStore();
    sessions.connectAgentEvents();

    // An idle event for a session that was not running changes nothing.
    listener?.({ type: "run-state", sessionId: "s1", state: "idle" });
    expect(unread.isUnread("s1")).toBe(false);

    listener?.({ type: "run-state", sessionId: "s1", state: "running" });
    expect(unread.isUnread("s1")).toBe(false);
    listener?.({ type: "run-state", sessionId: "s1", state: "idle" });
    expect(unread.isUnread("s1")).toBe(true);

    listener?.({ type: "run-state", sessionId: "s2", state: "running" });
    listener?.({ type: "run-state", sessionId: "s2", state: "failed" });
    expect(unread.isUnread("s2")).toBe(true);
  });
});
