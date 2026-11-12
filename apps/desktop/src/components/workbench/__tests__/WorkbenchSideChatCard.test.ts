import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, type PropType } from "vue";
import { createAppI18n } from "@/app/i18n";
import type { PineSessionSummary } from "@/shared/sessions";
import { useContentTabsStore } from "@/stores/contentTabs";
import type { PineTranscriptMessage } from "@/stores/session";
import { useSessionStore } from "@/stores/session";
import { useSideChatStore } from "@/stores/sideChat";
import WorkbenchSideChatCard from "../WorkbenchSideChatCard.vue";

const session: PineSessionSummary = {
  createdAt: "2026-11-05T00:00:00.000Z",
  id: "parent-session",
  messageCount: 2,
  preview: "First prompt",
  updatedAt: "2026-11-05T00:01:00.000Z",
};

/** Renders of each row, by message id. */
const rowRenders = new Map<string, number>();

const Passthrough = defineComponent({
  setup(_, { slots }) {
    return () => h("div", slots.default?.());
  },
});

const ItemStub = defineComponent({
  props: { messageId: { type: String, default: undefined } },
  setup(props, { slots }) {
    return () => {
      if (props.messageId)
        rowRenders.set(
          props.messageId,
          (rowRenders.get(props.messageId) ?? 0) + 1,
        );
      return h("div", { "data-row": props.messageId }, slots.default?.());
    };
  },
});

const MessageStub = defineComponent({
  props: {
    message: {
      type: Object as PropType<PineTranscriptMessage>,
      required: true,
    },
    canRewrite: { type: Boolean, default: false },
  },
  setup(props) {
    return () =>
      h(
        "p",
        { "data-can-rewrite": String(props.canRewrite) },
        props.message.blocks
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join(""),
      );
  },
});

const wrappers: ReturnType<typeof mount>[] = [];

async function mountCard() {
  const pinia = createPinia();
  setActivePinia(pinia);
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      onSideChatEvent: vi.fn(() => () => undefined),
      openSideChat: vi.fn().mockResolvedValue({
        sideChatId: "side-chat",
        parentSessionId: session.id,
        persistent: false,
        messages: [
          {
            id: "q1",
            message: { role: "user", content: [{ type: "text", text: "Q1" }] },
          },
          {
            id: "a1",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "A1" }],
            },
          },
        ],
      }),
      closeSideChat: vi.fn().mockResolvedValue({ closed: true }),
    },
  });
  useContentTabsStore().openSession(session, "project");
  useSessionStore().activeSession = session;
  const sideChats = useSideChatStore();
  await sideChats.open({ projectId: "project", sessionId: session.id });
  const wrapper = mount(WorkbenchSideChatCard, {
    props: { position: "top" },
    global: {
      plugins: [pinia, createAppI18n("en-US")],
      stubs: {
        MessageScrollerProvider: Passthrough,
        MessageScroller: Passthrough,
        MessageScrollerViewport: Passthrough,
        MessageScrollerContent: Passthrough,
        MessageScrollerItem: ItemStub,
        ProjectTranscriptMessage: MessageStub,
        WorkbenchCardPanelMenu: true,
        WorkbenchCardAddMenu: true,
        ProjectQuoteList: true,
      },
    },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return { sideChats, wrapper };
}

describe("WorkbenchSideChatCard", () => {
  beforeEach(() => {
    rowRenders.clear();
    localStorage.clear();
  });

  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  });

  it("re-renders only the streaming row", async () => {
    const { sideChats, wrapper } = await mountCard();
    sideChats.handleEvent({
      type: "message-update",
      sessionId: "side-chat",
      messageId: "a2",
      updates: [{ type: "text-start", contentIndex: 0, text: "A" }],
    });
    await nextTick();
    const settled = { q1: rowRenders.get("q1"), a1: rowRenders.get("a1") };
    const streamed = rowRenders.get("a2") ?? 0;

    for (const delta of ["b", "c", "d"]) {
      sideChats.handleEvent({
        type: "message-update",
        sessionId: "side-chat",
        messageId: "a2",
        updates: [{ type: "text-delta", contentIndex: 0, delta }],
      });
      await nextTick();
    }

    expect(rowRenders.get("q1")).toBe(settled.q1);
    expect(rowRenders.get("a1")).toBe(settled.a1);
    expect(rowRenders.get("a2")).toBe(streamed + 3);
    expect(wrapper.find('[data-row="a2"]').text()).toBe("Abcd");
  });

  it("updates every row when the side chat starts or stops running", async () => {
    const { sideChats, wrapper } = await mountCard();
    expect(
      wrapper.find('[data-row="q1"] p').attributes("data-can-rewrite"),
    ).toBe("true");

    sideChats.handleEvent({
      type: "run-state",
      sessionId: "side-chat",
      state: "running",
    });
    await nextTick();
    expect(
      wrapper.find('[data-row="q1"] p').attributes("data-can-rewrite"),
    ).toBe("false");

    sideChats.handleEvent({
      type: "session-error",
      sessionId: "side-chat",
      errorId: "error-1",
      message: "Broke",
    });
    sideChats.handleEvent({
      type: "run-state",
      sessionId: "side-chat",
      state: "idle",
    });
    await nextTick();
    expect(
      wrapper.find('[data-row="q1"] p').attributes("data-can-rewrite"),
    ).toBe("true");
    expect(wrapper.text()).toContain("Broke");
  });

  it("re-renders a row whose gap depends on the message before it", async () => {
    const { sideChats, wrapper } = await mountCard();
    sideChats.handleEvent({
      type: "message-end",
      sessionId: "side-chat",
      messageId: "a2",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "t", name: "read", arguments: {} }],
      },
    });
    await nextTick();
    expect(wrapper.find('[data-row="a2"]').classes().length).toBeGreaterThan(0);
  });
});
