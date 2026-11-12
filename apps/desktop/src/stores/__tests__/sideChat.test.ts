import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, isReactive, nextTick } from "vue";
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

  it("keeps streamed records raw and replaces them on every change", async () => {
    stubPine();
    const { sideChats } = await openSideChatWithQuestion();
    const chat = sideChats.active(session.id)!;
    const rows = computed(() => sideChats.active(session.id)?.messages ?? []);
    const base = { sessionId: "side-chat", messageId: "reply" } as const;

    sideChats.handleEvent({
      ...base,
      type: "message-update",
      updates: [{ type: "text-start", contentIndex: 0, text: "Be" }],
    });
    const first = rows.value[1];
    expect(isReactive(first)).toBe(false);
    expect(isReactive(first.blocks)).toBe(false);

    sideChats.handleEvent({
      ...base,
      type: "message-update",
      updates: [{ type: "text-delta", contentIndex: 0, delta: "cause" }],
    });
    const second = rows.value[1];
    expect(second).not.toBe(first);
    expect(first.blocks).toEqual([{ type: "text", text: "Be" }]);
    expect(second.blocks).toEqual([{ type: "text", text: "Because" }]);

    sideChats.handleEvent({
      ...base,
      type: "message-end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Because" },
          { type: "toolCall", id: "tool", name: "read", arguments: {} },
        ],
      },
    });
    const ended = rows.value[1];
    sideChats.handleEvent({
      type: "tool-end",
      sessionId: "side-chat",
      toolCallId: "tool",
      toolName: "read",
      payload: { content: [], details: null },
    });
    const withTool = rows.value[1];
    expect(withTool).not.toBe(ended);
    expect(isReactive(withTool)).toBe(false);
    expect(
      withTool.blocks.find((block) => block.type === "toolCall"),
    ).toMatchObject({ toolCall: { id: "tool", status: "complete" } });
    expect(chat.messages).toHaveLength(2);
  });

  it("keeps opened records raw", async () => {
    const pine = stubPine();
    pine.openSideChat.mockResolvedValue({
      sideChatId: "side-chat",
      parentSessionId: session.id,
      persistent: false,
      messages: [
        {
          id: "saved",
          message: { role: "user", content: [{ type: "text", text: "Hi" }] },
        },
      ],
    });
    useContentTabsStore().openSession(session, "project");
    const chat = await useSideChatStore().open({
      projectId: "project",
      sessionId: session.id,
    });
    expect(chat.messages).toHaveLength(1);
    expect(isReactive(chat.messages[0])).toBe(false);
  });
});
