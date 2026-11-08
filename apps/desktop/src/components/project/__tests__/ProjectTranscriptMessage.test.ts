import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createAppI18n } from "@/app/i18n";
import { serializeAttachmentMessage } from "@/shared/attachments";
import type { PineTranscriptMessage } from "@/stores/session";
import ProjectCompactionMarker from "../ProjectCompactionMarker.vue";
import ProjectErrorMarker from "../ProjectErrorMarker.vue";
import ProjectThinkingMarker from "../ProjectThinkingMarker.vue";
import ProjectTranscriptMessage from "../ProjectTranscriptMessage.vue";
import ProjectToolCallGroup from "../ProjectToolCallGroup.vue";
import ProjectToolCallMarker from "../ProjectToolCallMarker.vue";
import { provideMessageScroller } from "@/components/ui/message-scroller/useMessageScroller";

function mountMessage(
  message: PineTranscriptMessage,
  props: {
    canRewrite?: boolean;
    rewriteMessage?: (messageId: string, message: string) => Promise<boolean>;
  } = {},
) {
  return mount(ProjectTranscriptMessage, {
    props: { message, ...props },
    global: {
      plugins: [createAppI18n("zh-CN")],
    },
  });
}

describe("ProjectTranscriptMessage", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it.each(["text", "toolCall"] as const)(
    "only reserves the thinking hand-over for subsequent body text: %s",
    async (kind) => {
      const preserve = vi.fn();
      const message = ref<PineTranscriptMessage>({
        id: "assistant",
        createdAt: "2000-01-01T00:00:00Z",
        role: "assistant",
        status: "streaming",
        thinkingStatus: "streaming",
        blocks: [
          { type: "text", text: "Earlier output." },
          { type: "thinking", thinking: "Check the next file." },
        ],
      });
      const wrapper = mount(
        defineComponent({
          setup() {
            const engine = provideMessageScroller({ autoScroll: true });
            engine.context.preserveViewportOnCollapse = preserve;
            return () =>
              h(ProjectTranscriptMessage, { message: message.value });
          },
        }),
        { global: { plugins: [createAppI18n("en-US")] } },
      );
      try {
        expect(
          wrapper
            .findComponent(ProjectThinkingMarker)
            .get("button")
            .attributes("aria-expanded"),
        ).toBe("true");
        message.value = {
          ...message.value,
          thinkingStatus: "complete",
          blocks: [
            ...message.value.blocks,
            kind === "text"
              ? { type: "text", text: "Here is the result." }
              : {
                  type: "toolCall",
                  toolCall: {
                    id: "read",
                    name: "read",
                    status: "complete",
                    input: { path: "/tmp/file.ts" },
                  },
                },
          ],
        };
        await flushPromises();
        expect(
          wrapper
            .findComponent(ProjectThinkingMarker)
            .get("button")
            .attributes("aria-expanded"),
        ).toBe("false");
        expect(preserve).toHaveBeenCalledTimes(kind === "text" ? 1 : 0);
      } finally {
        wrapper.unmount();
      }
    },
  );

  it("renders streaming assistant output as Markdown too", () => {
    const wrapper = mountMessage({
      createdAt: "2026-08-26T00:00:00.000Z",
      id: "assistant-streaming",
      role: "assistant",
      status: "streaming",
      blocks: [{ type: "text", text: "**Still streaming**" }],
    });

    expect(wrapper.find('[data-slot="markdown-content"]').exists()).toBe(true);
    expect(wrapper.get('[data-slot="markdown-content"] strong').text()).toBe(
      "Still streaming",
    );
  });

  it("keeps user messages as plain text", () => {
    const wrapper = mountMessage({
      createdAt: "2026-08-26T00:00:00.000Z",
      id: "user-complete",
      role: "user",
      status: "complete",
      blocks: [{ type: "text", text: "**Literal prompt**" }],
    });

    expect(wrapper.find('[data-slot="markdown-content"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("**Literal prompt**");
  });

  it("shows an automation run's opening message as a card", async () => {
    const wrapper = mountMessage({
      createdAt: "2026-11-04T01:13:22.823Z",
      id: "user-run",
      role: "user",
      status: "complete",
      blocks: [
        {
          type: "text",
          text: [
            '<automation_run name="自动化自检" trigger="manual" started="2026-11-04T01:13:22.823Z" events="1">',
            "You are carrying out an automation the user approved.",
            "",
            "## Instructions",
            "写一份自检报告。",
            "",
            "## How this run works",
            "- Finish by calling automation_report exactly once.",
            "</automation_run>",
          ].join("\n"),
        },
      ],
    });

    const card = wrapper.get('[data-slot="automation-run-message"]');
    expect(card.text()).toContain("自动化自检");
    expect(card.text()).toContain("手动");
    expect(wrapper.find('[data-slot="user-message-row"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("automation_run");
    expect(wrapper.text()).not.toContain("automation_report");
    await wrapper.get('[data-slot="collapsible-trigger"]').trigger("click");
    expect(
      wrapper.get('[data-slot="automation-run-instructions"]').text(),
    ).toBe("写一份自检报告。");
  });

  it("renders parsed attachments above the user bubble and opens them", async () => {
    const openAttachment = vi.fn().mockResolvedValue({ opened: true });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: { openAttachment },
    });
    const wrapper = mountMessage({
      createdAt: "2026-09-02T12:00:00.000Z",
      id: "user-attachment",
      role: "user",
      status: "complete",
      blocks: [
        {
          type: "attachments",
          attachments: [
            {
              extension: "md",
              modifiedAt: "2026-09-02T11:59:00.000Z",
              name: "notes.md",
              path: "/Users/example/notes.md",
              size: 1_024,
            },
          ],
        },
        { type: "text", text: "Review this." },
      ],
    });

    const content = wrapper.get('[data-slot="message-content"]');
    expect(content.element.children[0]?.getAttribute("data-slot")).toBe(
      "attachment-group",
    );
    expect(content.element.children[1]?.getAttribute("data-slot")).toBe(
      "user-message-row",
    );
    expect(content.element.children).toHaveLength(2);
    const trigger = wrapper.get('[data-slot="attachment-trigger"]');
    expect(trigger.attributes("aria-label")).toBe("打开附件 notes.md");
    await trigger.trigger("click");
    await flushPromises();
    expect(openAttachment).toHaveBeenCalledWith({
      path: "/Users/example/notes.md",
    });
    expect(wrapper.text()).toContain("notes.md");
    expect(wrapper.text()).toContain("Review this.");
    expect(wrapper.text()).not.toContain("pine_attachments");
    expect(wrapper.get('[data-slot="user-message-text"]').text()).toBe(
      "Review this.",
    );
  });

  it("combines consecutive thinking blocks into one marker with no duplicated text", async () => {
    const wrapper = mountMessage({
      createdAt: "2000-01-01T00:00:00.000Z",
      id: "reasoning",
      role: "assistant",
      status: "complete",
      thinkingStatus: "complete",
      thinkingDurationMs: 18_000,
      blocks: [
        { type: "thinking", thinking: "**First summary**" },
        { type: "thinking", thinking: "**Second summary**" },
        { type: "thinking", thinking: "" },
      ],
    });
    try {
      const markers = wrapper.findAllComponents(ProjectThinkingMarker);
      expect(markers).toHaveLength(1);
      expect(markers[0].text()).toContain("已工作 18 秒");
      await markers[0].get("button").trigger("click");
      expect(
        wrapper
          .findAll("[data-thinking-content] strong")
          .map((node) => node.text()),
      ).toEqual(["First summary", "Second summary"]);
    } finally {
      wrapper.unmount();
    }
  });

  it("hides empty reasoning-only payloads", () => {
    const wrapper = mountMessage({
      createdAt: "2000-01-01T00:00:00.000Z",
      id: "empty-reasoning",
      role: "assistant",
      status: "complete",
      blocks: [
        { type: "thinking", thinking: " \n " },
        { type: "text", text: "Answer" },
      ],
    });
    expect(wrapper.findComponent(ProjectThinkingMarker).exists()).toBe(false);
    wrapper.unmount();
  });

  it("isolates thinking runs around body text and opens the new streaming run", async () => {
    const now = Date.now();
    const wrapper = mountMessage({
      createdAt: "2000-01-01T00:00:00.000Z",
      id: "separate-reasoning",
      role: "assistant",
      status: "streaming",
      thinkingStatus: "streaming",
      thinkingBlocks: {
        0: { status: "complete", startedAt: now - 3_000, durationMs: 1_000 },
        2: { status: "streaming", startedAt: now },
      },
      blocks: [
        { type: "thinking", thinking: "First summary" },
        { type: "text", text: "Progress update" },
        { type: "thinking", thinking: "Second summary" },
      ],
    });
    try {
      const markers = wrapper.findAllComponents(ProjectThinkingMarker);
      expect(markers).toHaveLength(2);
      expect(markers[0].get("button").attributes("aria-expanded")).toBe(
        "false",
      );
      expect(markers[1].get("button").attributes("aria-expanded")).toBe("true");
      expect(markers[0].props("message").thinkingDurationMs).toBe(1_000);
      expect(markers[1].props("message").thinkingStatus).toBe("streaming");
      await markers[0].get("button").trigger("click");
      expect(markers[0].get("[data-thinking-content]").text()).toBe(
        "First summary",
      );
      expect(markers[1].get("[data-thinking-content]").text()).toBe(
        "Second summary",
      );
    } finally {
      wrapper.unmount();
    }
  });

  it("does not repeat a legacy message's total duration on separate runs", () => {
    const wrapper = mountMessage({
      createdAt: "2000-01-01T00:00:00.000Z",
      id: "history-reasoning",
      role: "assistant",
      status: "complete",
      thinkingStatus: "complete",
      thinkingDurationMs: 18_000,
      blocks: [
        { type: "thinking", thinking: "First summary" },
        { type: "text", text: "Progress update" },
        { type: "thinking", thinking: "Second summary" },
      ],
    });
    for (const marker of wrapper.findAllComponents(ProjectThinkingMarker)) {
      expect(marker.props("message").thinkingDurationMs).toBeUndefined();
    }
    wrapper.unmount();
  });

  it("keeps the same marker and user expansion state when the run grows", async () => {
    const wrapper = mountMessage({
      createdAt: "2000-01-01T00:00:00.000Z",
      id: "growing-reasoning",
      role: "assistant",
      status: "streaming",
      thinkingStatus: "streaming",
      thinkingStartedAt: Date.now(),
      blocks: [{ type: "thinking", thinking: "First summary" }],
    });
    try {
      const marker = wrapper.getComponent(ProjectThinkingMarker);
      await marker.get("button").trigger("click");
      expect(marker.get("button").attributes("aria-expanded")).toBe("false");
      await wrapper.setProps({
        message: {
          ...wrapper.props("message"),
          blocks: [
            { type: "thinking", thinking: "First summary" },
            { type: "thinking", thinking: "Second summary" },
          ],
        },
      });
      expect(wrapper.findAllComponents(ProjectThinkingMarker)).toHaveLength(1);
      expect(
        wrapper.getComponent(ProjectThinkingMarker).get("button").element,
      ).toBe(marker.get("button").element);
      expect(marker.get("button").attributes("aria-expanded")).toBe("false");
    } finally {
      wrapper.unmount();
    }
  });

  it("renders a single tool call in full instead of folding it", () => {
    const wrapper = mountMessage({
      createdAt: "2026-08-26T00:00:00.000Z",
      id: "assistant-single-tool",
      role: "assistant",
      status: "complete",
      blocks: [
        {
          type: "toolCall",
          toolCall: {
            id: "call-read",
            name: "read",
            status: "complete",
            input: { path: "/project/src/main.ts" },
          },
        },
      ],
    });

    expect(wrapper.findComponent(ProjectToolCallGroup).exists()).toBe(false);
    expect(wrapper.findComponent(ProjectToolCallMarker).exists()).toBe(true);
  });

  it("shows a dedicated MCP call marker with its tool target", () => {
    const wrapper = mountMessage({
      createdAt: "2026-09-25T00:00:00.000Z",
      id: "assistant-mcp-tool",
      role: "assistant",
      status: "complete",
      blocks: [
        {
          type: "toolCall",
          toolCall: {
            id: "call-mcp",
            name: "mcp",
            status: "complete",
            input: { server: "github", tool: "search_repositories", args: {} },
          },
        },
      ],
    });

    expect(wrapper.findComponent(ProjectToolCallMarker).exists()).toBe(true);
    expect(wrapper.text()).toContain(
      "已执行 MCP 工具调用 github.search_repositories",
    );
  });

  it("renders session errors as destructive markers", () => {
    const wrapper = mountMessage({
      createdAt: "2026-08-26T00:00:00.000Z",
      id: "assistant-error",
      role: "assistant",
      status: "complete",
      blocks: [
        {
          type: "error",
          error: { message: "Provider request failed" },
        },
      ],
    });

    const marker = wrapper.getComponent(ProjectErrorMarker);
    expect(marker.get('[data-slot="marker-content"]').text()).toBe(
      "错误: Provider request failed",
    );
  });

  it("renders compaction markers in the assistant transcript", () => {
    const wrapper = mountMessage({
      createdAt: "2026-08-26T00:00:00.000Z",
      id: "assistant-compaction",
      role: "assistant",
      status: "streaming",
      blocks: [
        {
          type: "compaction",
          compaction: { id: "compaction-1", status: "running" },
        },
      ],
    });

    expect(wrapper.findComponent(ProjectCompactionMarker).exists()).toBe(true);
    expect(wrapper.text()).toContain("正在压缩上下文");
  });

  it("folds consecutive tool calls into a step group", () => {
    const wrapper = mountMessage({
      createdAt: "2026-08-26T00:00:00.000Z",
      id: "assistant-multi-tool",
      role: "assistant",
      status: "complete",
      blocks: [
        {
          type: "toolCall",
          toolCall: {
            id: "call-bash",
            name: "bash",
            status: "complete",
            input: { command: "bun run check" },
          },
        },
        {
          type: "toolCall",
          toolCall: {
            id: "call-read",
            name: "read",
            status: "complete",
            input: { path: "/project/src/main.ts" },
          },
        },
      ],
    });

    expect(wrapper.findComponent(ProjectToolCallGroup).exists()).toBe(true);
  });

  it("copies the user message text from the hover actions", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const wrapper = mountMessage({
      createdAt: "2026-10-02T00:00:00.000Z",
      id: "user-copy",
      role: "user",
      status: "complete",
      blocks: [{ type: "text", text: "Copy me" }],
    });

    await wrapper.get('[aria-label="复制消息"]').trigger("click");
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith("Copy me");
    // Editing is offered only when the session view can rewrite history.
    expect(wrapper.find('[aria-label="编辑消息"]').exists()).toBe(false);
  });

  it("edits a user message in place and sends it with its attachments", async () => {
    const rewriteMessage = vi.fn().mockResolvedValue(true);
    const attachment = {
      extension: "md",
      modifiedAt: "2026-10-02T00:00:00.000Z",
      name: "notes.md",
      path: "/Users/example/notes.md",
      size: 10,
    };
    const wrapper = mountMessage(
      {
        createdAt: "2026-10-02T00:00:00.000Z",
        id: "user-edit",
        role: "user",
        status: "complete",
        blocks: [
          { type: "attachments", attachments: [attachment] },
          { type: "text", text: "Original" },
        ],
      },
      { canRewrite: true, rewriteMessage },
    );

    await wrapper.get('[aria-label="编辑消息"]').trigger("click");
    const editor = wrapper.get('[data-slot="user-message-editor"]');
    expect((editor.element as HTMLTextAreaElement).value).toBe("Original");

    await editor.setValue("Rewritten");
    await wrapper
      .findAll('[data-slot="user-message-edit-actions"] button')
      .find((button) => button.text() === "发送")
      ?.trigger("click");
    await flushPromises();

    expect(rewriteMessage).toHaveBeenCalledWith(
      "user-edit",
      serializeAttachmentMessage([attachment], "Rewritten"),
    );
    expect(wrapper.find('[data-slot="user-message-editor"]').exists()).toBe(
      false,
    );
  });

  it("cancels an in-place edit without sending", async () => {
    const rewriteMessage = vi.fn().mockResolvedValue(true);
    const wrapper = mountMessage(
      {
        createdAt: "2026-10-02T00:00:00.000Z",
        id: "user-cancel",
        role: "user",
        status: "complete",
        blocks: [{ type: "text", text: "Keep me" }],
      },
      { canRewrite: true, rewriteMessage },
    );

    await wrapper.get('[aria-label="编辑消息"]').trigger("click");
    await wrapper.get('[data-slot="user-message-editor"]').setValue("Changed");
    await wrapper
      .get('[data-slot="user-message-editor"]')
      .trigger("keydown", { key: "Escape" });

    expect(rewriteMessage).not.toHaveBeenCalled();
    expect(wrapper.get('[data-slot="user-message-text"]').text()).toBe(
      "Keep me",
    );
  });

  it("disables editing while the session is running", () => {
    const wrapper = mountMessage(
      {
        createdAt: "2026-10-02T00:00:00.000Z",
        id: "user-running",
        role: "user",
        status: "complete",
        blocks: [{ type: "text", text: "Busy" }],
      },
      { canRewrite: false, rewriteMessage: vi.fn() },
    );

    expect(
      wrapper.get('[aria-label="编辑消息"]').attributes("disabled"),
    ).toBeDefined();
  });
});
