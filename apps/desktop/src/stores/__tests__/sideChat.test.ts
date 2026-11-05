import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import type { PineSessionSummary } from "@/shared/sessions";
import { useContentTabsStore } from "../contentTabs";
import { useSideChatStore } from "../sideChat";

const session: PineSessionSummary = {
  createdAt: "2026-11-05T00:00:00.000Z",
  id: "parent-session",
  messageCount: 2,
  preview: "First prompt",
  updatedAt: "2026-11-05T00:01:00.000Z",
};

function stubPine() {
  const pine = {
    onSideChatEvent: vi.fn(() => () => undefined),
    openSideChat: vi.fn().mockResolvedValue({
      sideChatId: "side-chat",
      parentSessionId: session.id,
      persistent: false,
      messages: [],
    }),
    closeSideChat: vi.fn().mockResolvedValue({ closed: true }),
  };
  Object.defineProperty(window, "pine", { configurable: true, value: pine });
  return pine;
}

async function openSideChatWithQuestion() {
  const tabs = useContentTabsStore();
  const tab = tabs.openSession(session, "project");
  const sideChats = useSideChatStore();
  const chat = await sideChats.open({
    projectId: "project",
    sessionId: session.id,
  });
  chat.messages.push({
    createdAt: "2026-11-05T00:02:00.000Z",
    id: "question",
    role: "user",
    blocks: [{ type: "text", text: "Why?" }],
    status: "complete",
  });
  return { sideChats, tab, tabs };
}

describe("side chat store", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("asks before its conversation's tab takes a plain side chat with it", async () => {
    const pine = stubPine();
    const { sideChats } = await openSideChatWithQuestion();

    const declined = sideChats.endFor(session.id);
    expect(sideChats.discardRequest?.reason).toBe("tab");
    sideChats.answerDiscard(false);
    expect(await declined).toBe(false);
    expect(sideChats.active(session.id)).toBeDefined();

    const confirmed = sideChats.endFor(session.id);
    sideChats.answerDiscard(true);
    expect(await confirmed).toBe(true);
    expect(sideChats.active(session.id)).toBeUndefined();
    expect(pine.closeSideChat).toHaveBeenCalledWith({
      projectId: "project",
      sideChatId: "side-chat",
    });
  });

  it("keeps a side chat while a tab shows its conversation", async () => {
    const pine = stubPine();
    const { sideChats, tab, tabs } = await openSideChatWithQuestion();

    tabs.createSessionTab();
    await nextTick();
    expect(sideChats.active(session.id)).toBeDefined();

    tabs.close(tab.id, tab.id);
    await nextTick();
    expect(sideChats.active(session.id)).toBeUndefined();
    expect(pine.closeSideChat).toHaveBeenCalledOnce();
  });
});
