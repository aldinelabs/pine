import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { ASSISTANT_PROJECT_ID } from "@/shared/assistant";
import { TEMPORARY_WORKSPACE_PROJECT_ID } from "@/shared/projects";
import type { PineSessionSummary } from "@/shared/sessions";
import { useContentTabsStore } from "../contentTabs";

const thread: PineSessionSummary = {
  createdAt: "c",
  id: "11111111-1111-4111-8111-111111111111",
  messageCount: 4,
  updatedAt: "u",
};

function assistantTabs(store: ReturnType<typeof useContentTabsStore>) {
  return store.tabs.filter((tab) => tab.projectId === ASSISTANT_PROJECT_ID);
}

describe("the Assistant's tab", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("opens its conversation once, however often it is asked for", () => {
    const store = useContentTabsStore();

    const first = store.openAssistant(thread);
    const again = store.openAssistant(thread);

    expect(again.id).toBe(first.id);
    expect(assistantTabs(store)).toEqual([
      expect.objectContaining({ state: "bound", sessionId: thread.id }),
    ]);
  });

  it("starts as a draft that binds once its conversation exists", () => {
    const store = useContentTabsStore();

    const draft = store.openAssistant();
    expect(draft).toMatchObject({ state: "draft" });

    const bound = store.openAssistant(thread);
    expect(bound.id).toBe(draft.id);
    expect(bound).toMatchObject({ state: "bound", sessionId: thread.id });
  });

  it("is never reused as someone's new session", () => {
    const store = useContentTabsStore();
    store.tabs = [];
    const assistant = store.openAssistant();

    const draft = store.createSessionTab({
      projectId: TEMPORARY_WORKSPACE_PROJECT_ID,
    });

    expect(draft.id).not.toBe(assistant.id);
    expect(store.tabs.find((tab) => tab.id === assistant.id)?.projectId).toBe(
      ASSISTANT_PROJECT_ID,
    );
  });
});
