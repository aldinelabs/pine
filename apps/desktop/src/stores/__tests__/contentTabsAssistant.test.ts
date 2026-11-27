import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { TEMPORARY_WORKSPACE_PROJECT_ID } from "@/shared/projects";
import type { PineSessionSummary } from "@/shared/sessions";
import { isOrchestratorTab, useContentTabsStore } from "../contentTabs";

const thread: PineSessionSummary = {
  createdAt: "c",
  id: "11111111-1111-4111-8111-111111111111",
  messageCount: 4,
  updatedAt: "u",
  orchestrator: true,
};

function assistantTabs(store: ReturnType<typeof useContentTabsStore>) {
  return store.tabs.filter(isOrchestratorTab);
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
    expect(draft).toMatchObject({
      state: "draft",
      projectId: TEMPORARY_WORKSPACE_PROJECT_ID,
      orchestrator: true,
    });

    const bound = store.openAssistant(thread);
    expect(bound.id).toBe(draft.id);
    expect(bound).toMatchObject({
      state: "bound",
      sessionId: thread.id,
      orchestrator: true,
    });
  });

  it("is never reused as someone's new session", () => {
    const store = useContentTabsStore();
    store.tabs = [];
    const assistant = store.openAssistant();

    const draft = store.createSessionTab({
      projectId: TEMPORARY_WORKSPACE_PROJECT_ID,
    });

    expect(draft.id).not.toBe(assistant.id);
    expect(
      isOrchestratorTab(store.tabs.find((tab) => tab.id === assistant.id)),
    ).toBe(true);
  });

  it("keeps its flag when a failed first message returns it to a draft", () => {
    const store = useContentTabsStore();
    const assistant = store.openAssistant();

    store.beginPrompt(assistant.id, "你好");
    expect(store.tabs.find((tab) => tab.id === assistant.id)).toMatchObject({
      state: "creating",
      orchestrator: true,
    });
    expect(store.failPrompt(assistant.id)).toBe(assistant.id);
    expect(store.tabs.find((tab) => tab.id === assistant.id)).toMatchObject({
      state: "draft",
      orchestrator: true,
    });
  });
});
