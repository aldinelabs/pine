import { PROJECT_ENTRY_DRAG_TYPE } from "@/lib/projectFileDrag";
import { SESSION_DRAG_TYPE } from "@/lib/sessionDrag";
import { flushPromises, mount } from "@vue/test-utils";
import { computed, ref } from "vue";
import { useSessionStore } from "@/stores/session";
import { useContentTabsStore } from "@/stores/contentTabs";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { serializeAttachmentMessage } from "@/shared/attachments";
import ProjectSessionView from "../ProjectSessionView.vue";

const activeTabId = ref("session-1");
const navigationTabs = ref([]);
const activateTab = vi.fn();
let followingBottom = true;

vi.mock("@/composables/useContentTabNavigation", () => ({
  useContentTabNavigation: () => ({
    activeTabId: computed(() => activeTabId.value),
    activate: activateTab,
    bindSession: vi.fn(),
    failPrompt: vi.fn(),
    tabs: navigationTabs,
  }),
}));

function fileTransfer(files: File[] = []): DataTransfer {
  return {
    dropEffect: "none",
    files,
    types: ["Files"],
  } as unknown as DataTransfer;
}

function mountView() {
  activeTabId.value = "session-1";
  const pinia = createPinia();
  setActivePinia(pinia);
  const inspectAttachments = vi.fn().mockResolvedValue({
    attachments: [
      {
        extension: "md",
        modifiedAt: "2026-09-02T12:00:00.000Z",
        name: "notes.md",
        path: "/tmp/notes.md",
        size: 1_024,
      },
    ],
  });
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      getPathForFile: (file: File) => `/tmp/${file.name}`,
      inspectAttachments,
      onSessionEvent: () => () => undefined,
      openProject: vi.fn(({ id }: { id: string }) =>
        Promise.resolve({ opened: true, project: { id } }),
      ),
    },
  });

  const slotStub = { template: "<div><slot /></div>" };
  const viewportStub = {
    methods: {
      emitProgrammaticScroll(this: {
        $emit: (
          event: "scroll",
          payload: { currentTarget: HTMLElement },
          isProgrammatic: boolean,
        ) => void;
        $el: HTMLElement;
      }) {
        this.$emit("scroll", { currentTarget: this.$el }, true);
      },
    },
    template:
      '<div data-slot="message-viewport-stub"><button data-slot="programmatic-scroll-stub" @click="emitProgrammaticScroll" /><slot /></div>',
  };
  const wrapper = mount(ProjectSessionView, {
    props: { projectId: "p1", tabId: "session-1" },
    global: {
      plugins: [pinia, createAppI18n("zh-CN")],
      stubs: {
        MessageScrollerProvider: {
          template: "<div><slot /></div>",
          methods: { isFollowingBottom: () => followingBottom },
        },
        MessageScroller: slotStub,
        MessageScrollerViewport: viewportStub,
        MessageScrollerContent: slotStub,
        MessageScrollerItem: slotStub,
        PineCharacter: true,
        ProjectSessionComposer: {
          props: ["attachments", "modelValue", "steeringMessages"],
          template:
            '<div data-slot="composer-stub" :data-attachment-count="attachments?.length ?? 0" :data-draft="modelValue"><button data-slot="submit-new-stub" @click="$emit(\'submit\', \'Start\')" /><button data-slot="submit-steering-stub" @click="$emit(\'submit\', \'Change direction\')" /><button v-if="steeringMessages?.length" data-slot="withdraw-steering-stub" @click="$emit(\'withdrawSteering\', steeringMessages[0])" /></div>',
        },
        ProjectTranscriptMessage: true,
        ProjectTranscriptOutline: {
          name: "ProjectTranscriptOutline",
          props: ["ensureMessageLoaded", "turns"],
          template:
            '<div><button v-if="turns?.length" data-slot="ensure-message-stub" @click="$emit(\'navigationStateChange\', true); ensureMessageLoaded(turns[0].id)" /></div>',
        },
      },
    },
  });
  return { inspectAttachments, wrapper };
}

describe("ProjectSessionView file drop", () => {
  it("reopens a historical presented file from the project temporary directory", async () => {
    const { wrapper } = mountView();
    const sessionId = "0198e338-fb55-7e18-a23e-a7028500f123";
    const toolCall = {
      id: "old-present-call",
      name: "ui_present_file",
      status: "complete" as const,
      input: { path: "/Pine/projects/project/tmp/tool_probe.txt" },
    };
    const filePath = "/Pine/projects/project/tmp/tool_probe.txt";
    const reopen = vi.fn().mockResolvedValue({
      source: "presented",
      path: filePath,
    });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: { ...window.pine, reopenPresentedToolFile: reopen },
    });
    await wrapper.setProps({ sessionId });
    useSessionStore().stateFor(sessionId).messages = [
      {
        id: "historical-message",
        createdAt: "2026-09-03T00:00:00Z",
        role: "assistant",
        status: "complete",
        blocks: [{ type: "toolCall", toolCall }],
      },
    ];
    await flushPromises();

    const message = wrapper.findComponent({ name: "ProjectTranscriptMessage" });
    expect(message.exists()).toBe(true);
    const openFile = message.props("openFile") as (
      path: string,
      call: typeof toolCall,
    ) => Promise<boolean>;
    expect(await openFile(filePath, toolCall)).toBe(true);
    expect(reopen).toHaveBeenCalledWith({
      projectId: "p1",
      sessionId,
      toolCallId: toolCall.id,
    });
    const fileTab = useContentTabsStore().tabs.find(
      (tab) => tab.kind === "file",
    );
    expect(fileTab).toMatchObject({
      path: filePath,
      projectId: "p1",
      source: "presented",
    });
    expect(activateTab).toHaveBeenCalledWith(fileTab?.id);
    wrapper.unmount();
  });

  it("keeps the empty state content above the parallax background", async () => {
    const { wrapper } = mountView();
    await flushPromises();

    expect(
      wrapper.find('[data-slot="session-parallax-background"]').exists(),
    ).toBe(true);
    expect(
      wrapper.get('[data-slot="session-parallax-background"]').element
        .parentElement,
    ).toBe(wrapper.get('[data-slot="session-transcript-region"]').element);
    expect(wrapper.text()).toContain("不妨大胆想象");
    expect(wrapper.text()).toContain(
      "从一个问题、一项任务，或一个大胆的想法开始。",
    );
    wrapper.unmount();
  });

  it("removes the parallax background as soon as a new prompt is submitted", async () => {
    const { wrapper } = mountView();
    const sessionStore = useSessionStore();
    vi.spyOn(sessionStore, "prompt").mockImplementation(
      () => new Promise<never>(() => {}),
    );
    expect(
      wrapper.find('[data-slot="session-parallax-background"]').exists(),
    ).toBe(true);

    await wrapper.get('[data-slot="submit-new-stub"]').trigger("click");

    expect(
      wrapper.find('[data-slot="session-parallax-background"]').exists(),
    ).toBe(false);
    expect(useContentTabsStore().tabs[0]).toMatchObject({ state: "creating" });
    wrapper.unmount();
  });

  it("shows a loading indicator while earlier messages are fetched", async () => {
    const { wrapper } = mountView();
    const sessionStore = useSessionStore().stateFor("session-a");
    await wrapper.setProps({ sessionId: "session-a" });
    sessionStore.hasEarlierMessages = true;
    sessionStore.messages = [
      {
        id: "loaded-message",
        createdAt: "2026-09-03T00:00:00Z",
        role: "assistant",
        status: "complete",
        blocks: [],
      },
    ];
    sessionStore.isLoadingMessages = true;
    await flushPromises();

    expect(wrapper.get('[data-slot="history-loading"]')).toBeTruthy();
    expect(wrapper.find('button[data-variant="secondary"]').exists()).toBe(
      false,
    );
  });

  it("loads earlier messages when the transcript reaches the top threshold", async () => {
    const { wrapper } = mountView();
    const sessionStore = useSessionStore();
    sessionStore.hasEarlierMessages = true;
    const loadEarlierMessages = vi
      .spyOn(sessionStore, "loadEarlierMessages")
      .mockResolvedValue();

    await wrapper.get('[data-slot="message-viewport-stub"]').trigger("scroll");

    expect(loadEarlierMessages).toHaveBeenCalledOnce();
  });

  it("does not load earlier messages during a programmatic transcript jump", async () => {
    const { wrapper } = mountView();
    const sessionStore = useSessionStore();
    sessionStore.hasEarlierMessages = true;
    const loadEarlierMessages = vi
      .spyOn(sessionStore, "loadEarlierMessages")
      .mockResolvedValue();
    await wrapper
      .get('[data-slot="programmatic-scroll-stub"]')
      .trigger("click");

    await flushPromises();
    expect(loadEarlierMessages).not.toHaveBeenCalled();
  });

  it("waits for the target page and hides the history spinner during navigation", async () => {
    const { wrapper } = mountView();
    const sessionStore = useSessionStore().stateFor("session-a");
    await wrapper.setProps({ sessionId: "session-a" });
    const target = {
      id: "target-message",
      createdAt: "2026-09-03T00:00:00Z",
      role: "user" as const,
      status: "complete" as const,
      blocks: [{ type: "text" as const, text: "Target" }],
    };
    sessionStore.outlineMessages = [target];
    sessionStore.messages = [
      {
        id: "newer-message",
        createdAt: "2026-09-04T00:00:00Z",
        role: "assistant",
        status: "complete",
        blocks: [],
      },
    ];
    sessionStore.hasEarlierMessages = true;
    let resolvePage: (() => void) | undefined;
    const loadEarlierMessages = vi
      .spyOn(useSessionStore(), "loadEarlierMessages")
      .mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            sessionStore.isLoadingMessages = true;
            resolvePage = () => {
              sessionStore.messages = [target, ...sessionStore.messages];
              sessionStore.hasEarlierMessages = false;
              sessionStore.isLoadingMessages = false;
              resolve();
            };
          }),
      );
    await flushPromises();

    await wrapper.get('[data-slot="ensure-message-stub"]').trigger("click");
    expect(wrapper.find('[data-slot="history-loading"]').exists()).toBe(false);
    expect(loadEarlierMessages).toHaveBeenCalledOnce();
    resolvePage?.();
    await flushPromises();

    expect(sessionStore.messages[0]?.id).toBe(target.id);
    expect(loadEarlierMessages).toHaveBeenCalledOnce();
  });

  it("trims the rendered window at the live end and reveals it before fetching", async () => {
    const { wrapper } = mountView();
    followingBottom = true;
    const state = useSessionStore().stateFor("session-a");
    await wrapper.setProps({ sessionId: "session-a" });
    const loadEarlierMessages = vi
      .spyOn(useSessionStore(), "loadEarlierMessages")
      .mockResolvedValue();
    const transcript = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: `message-${index}`,
        createdAt: "2026-09-03T00:00:00Z",
        role: "assistant" as const,
        status: "complete" as const,
        blocks: [],
      }));
    const rendered = () =>
      wrapper
        .findAllComponents({ name: "ProjectTranscriptMessage" })
        .map((message) => message.props("message").id as string);

    state.messages = transcript(100);
    await flushPromises();
    expect(rendered()).toHaveLength(100);

    state.messages = transcript(130);
    await flushPromises();
    expect(rendered()).toHaveLength(60);
    expect(rendered()[0]).toBe("message-70");

    await wrapper.get('[data-slot="message-viewport-stub"]').trigger("scroll");
    await flushPromises();
    expect(rendered()).toHaveLength(110);
    expect(loadEarlierMessages).not.toHaveBeenCalled();

    // A reader away from the live end keeps everything they have revealed.
    followingBottom = false;
    state.messages = transcript(180);
    await flushPromises();
    expect(rendered()).toHaveLength(160);
    wrapper.unmount();
  });

  it("holds a background transcript until its tab is shown again", async () => {
    const { wrapper } = mountView();
    const state = useSessionStore().stateFor("session-a");
    await wrapper.setProps({ sessionId: "session-a" });
    const message = (id: string) => ({
      id,
      createdAt: "2026-09-03T00:00:00Z",
      role: "assistant" as const,
      status: "complete" as const,
      blocks: [],
    });
    const rendered = () =>
      wrapper.findAllComponents({ name: "ProjectTranscriptMessage" }).length;
    state.messages = [message("first")];
    await flushPromises();

    activeTabId.value = "file-tab";
    await flushPromises();
    state.messages = [message("first"), message("second")];
    await flushPromises();
    expect(rendered()).toBe(1);

    activeTabId.value = "session-1";
    await flushPromises();
    expect(rendered()).toBe(2);
    wrapper.unmount();
  });

  it("steers the session owned by a bound tab", async () => {
    const { wrapper } = mountView();
    const sessionStore = useSessionStore();
    const contentTabsStore = useContentTabsStore();
    const runningSession = {
      id: "019cfe51-7166-79b9-a5b9-c652fcca9eab",
      createdAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:00.000Z",
      messageCount: 1,
    };
    const promptSession = vi.fn().mockResolvedValue({
      accepted: true,
      session: runningSession,
    });
    window.pine.loadSessionMessages = vi.fn().mockResolvedValue({
      hasMore: false,
      messages: [],
    });
    window.pine.resumeSession = vi.fn().mockResolvedValue({
      session: runningSession,
    });
    window.pine.promptSession = promptSession;
    await sessionStore.resume("p1", runningSession.id);
    await wrapper.setProps({ sessionId: runningSession.id });
    sessionStore.isRunning = true;
    contentTabsStore.beginPrompt("session-1", "Initial prompt");
    await flushPromises();

    await wrapper.get('[data-slot="submit-steering-stub"]').trigger("click");
    await flushPromises();

    expect(promptSession).toHaveBeenCalledWith({
      locale: "en-US",
      message: "Change direction",
      target: {
        kind: "session",
        projectId: "p1",
        sessionId: runningSession.id,
      },
      approvalMode: "auto-approve",
      streamingBehavior: "steer",
    });
    expect(contentTabsStore.tabs[0]).toEqual(
      expect.objectContaining({ state: "creating" }),
    );
  });

  it("restores a dequeued steering message and its attachments to the composer", async () => {
    const { wrapper } = mountView();
    const sessionStore = useSessionStore().stateFor("session-a");
    await wrapper.setProps({ sessionId: "session-a" });
    const attachment = {
      extension: "md",
      modifiedAt: "2026-09-02T12:00:00.000Z",
      name: "notes.md",
      path: "/tmp/notes.md",
      size: 1_024,
    };
    const queued = serializeAttachmentMessage([attachment], "Change direction");
    window.pine.dequeueSteering = vi.fn().mockResolvedValue({
      message: queued,
      removed: true,
    });
    sessionStore.steeringMessages = [queued];
    await flushPromises();

    await wrapper.get('[data-slot="withdraw-steering-stub"]').trigger("click");
    await flushPromises();

    const composer = wrapper.get('[data-slot="composer-stub"]');
    expect(composer.attributes("data-draft")).toBe("Change direction");
    expect(composer.attributes("data-attachment-count")).toBe("1");
  });

  it("receives attachments for its own composer while in the background", async () => {
    const { wrapper } = mountView();
    const store = useContentTabsStore();
    activeTabId.value = "file-tab";
    const attachment = {
      name: "notes.md",
      path: "/project/notes.md",
      extension: "md",
      size: 12,
      modifiedAt: "",
    };
    store.addAttachments("session-1", [attachment]);
    await flushPromises();
    expect(
      wrapper
        .get('[data-slot="composer-stub"]')
        .attributes("data-attachment-count"),
    ).toBe("1");
    wrapper.unmount();
  });
  it("keeps a hidden view on its own transcript while the active session changes", async () => {
    const { wrapper } = mountView();
    const store = useSessionStore().stateFor("session-a");
    await wrapper.setProps({ sessionId: "session-a" });
    store.messages = [
      {
        id: "first-message",
        createdAt: "2026-09-03T00:00:00Z",
        role: "assistant",
        status: "complete",
        blocks: [{ type: "text", text: "First session" }],
      },
    ];
    await flushPromises();
    const firstMessages = wrapper
      .findComponent({ name: "ProjectTranscriptOutline" })
      .props("messages");

    activeTabId.value = "session-2";
    useSessionStore().stateFor("session-b").messages = [
      {
        id: "second-message",
        createdAt: "2026-09-03T00:00:00Z",
        role: "assistant",
        status: "complete",
        blocks: [{ type: "text", text: "Second session" }],
      },
    ];
    await flushPromises();

    expect(
      wrapper
        .findComponent({ name: "ProjectTranscriptOutline" })
        .props("messages"),
    ).toBe(firstMessages);
    expect(
      wrapper
        .findComponent({ name: "ProjectTranscriptMessage" })
        .props("message").id,
    ).toBe("first-message");
    wrapper.unmount();
  });

  it("shows and clears the attachment drop overlay", async () => {
    const { wrapper } = mountView();
    const layout = wrapper.get(".session-layout");

    await layout.trigger("dragenter", { dataTransfer: fileTransfer() });
    const overlay = wrapper.get('[data-slot="attachment-drop-overlay"]');
    expect(overlay.attributes("role")).toBe("status");
    expect(overlay.text()).toContain("松手以添加附件");
    expect(overlay.text()).toContain("可以一次添加多个文件或文件夹");

    await layout.trigger("dragleave", { dataTransfer: fileTransfer() });
    expect(wrapper.find('[data-slot="attachment-drop-overlay"]').exists()).toBe(
      false,
    );
  });

  it("resolves dropped files and adds them to the composer", async () => {
    const { inspectAttachments, wrapper } = mountView();
    const layout = wrapper.get(".session-layout");
    const file = new File(["# Notes"], "notes.md", {
      type: "text/markdown",
    });

    await layout.trigger("dragenter", { dataTransfer: fileTransfer([file]) });
    await layout.trigger("drop", { dataTransfer: fileTransfer([file]) });
    await flushPromises();

    expect(inspectAttachments).toHaveBeenCalledWith({
      paths: ["/tmp/notes.md"],
    });
    expect(
      wrapper
        .get('[data-slot="composer-stub"]')
        .attributes("data-attachment-count"),
    ).toBe("1");
    expect(wrapper.find('[data-slot="attachment-drop-overlay"]').exists()).toBe(
      false,
    );
  });

  it("forwards a dropped folder path to attachment inspection", async () => {
    const { inspectAttachments, wrapper } = mountView();
    const layout = wrapper.get(".session-layout");
    const folder = new File([], "references");

    await layout.trigger("drop", { dataTransfer: fileTransfer([folder]) });
    await flushPromises();

    expect(inspectAttachments).toHaveBeenCalledWith({
      paths: ["/tmp/references"],
    });
  });

  it("adds internal tree entries through the existing attachment system and deduplicates them", async () => {
    const { wrapper } = mountView();
    const entries = [
      { folderId: "folder-1", projectId: "p1", relativePath: "notes.md" },
    ];
    const inspectProjectAttachments = vi.fn().mockResolvedValue({
      attachments: [
        {
          kind: "file",
          name: "notes.md",
          path: "/project/notes.md",
          size: 12,
          extension: "md",
        },
      ],
    });
    window.pine.inspectProjectAttachments = inspectProjectAttachments;
    const transfer = {
      types: [PROJECT_ENTRY_DRAG_TYPE],
      files: [],
      getData: () => JSON.stringify(entries),
    };
    const layout = wrapper.get(".session-layout");
    await layout.trigger("dragenter", { dataTransfer: transfer });
    expect(wrapper.find('[data-slot="attachment-drop-overlay"]').exists()).toBe(
      true,
    );
    await layout.trigger("drop", { dataTransfer: transfer });
    await flushPromises();
    await layout.trigger("drop", { dataTransfer: transfer });
    await flushPromises();
    expect(inspectProjectAttachments).toHaveBeenCalledWith(entries);
    expect(
      wrapper
        .get('[data-slot="composer-stub"]')
        .attributes("data-attachment-count"),
    ).toBe("1");
    expect(wrapper.find('[data-slot="attachment-drop-overlay"]').exists()).toBe(
      false,
    );
  });

  it("resolves an internally dragged conversation as a JSONL attachment and deduplicates it", async () => {
    const { wrapper } = mountView();
    const attachment = {
      extension: "jsonl",
      kind: "file" as const,
      modifiedAt: "2026-09-02T12:00:00.000Z",
      name: "Architecture review.jsonl",
      path: "/pine/projects/p1/sessions/session.jsonl",
      size: 2_048,
    };
    const attachSession = vi.fn().mockResolvedValue({ attachment });
    window.pine.attachSession = attachSession;
    const transfer = {
      types: [SESSION_DRAG_TYPE],
      files: [],
      getData: () => "019cfe51-7166-79b9-a5b9-c652fcca9eab",
      dropEffect: "none",
    };
    const layout = wrapper.get(".session-layout");

    await layout.trigger("dragenter", { dataTransfer: transfer });
    expect(wrapper.find('[data-slot="attachment-drop-overlay"]').exists()).toBe(
      true,
    );
    await layout.trigger("drop", { dataTransfer: transfer });
    await flushPromises();
    await layout.trigger("drop", { dataTransfer: transfer });
    await flushPromises();

    expect(attachSession).toHaveBeenCalledWith({
      projectId: "p1",
      sessionId: "019cfe51-7166-79b9-a5b9-c652fcca9eab",
    });
    expect(
      wrapper
        .get('[data-slot="composer-stub"]')
        .attributes("data-attachment-count"),
    ).toBe("1");
  });

  it("rejects malformed internal drags without inspecting arbitrary paths", async () => {
    const { wrapper, inspectAttachments } = mountView();
    const inspectProjectAttachments = vi.fn();
    window.pine.inspectProjectAttachments = inspectProjectAttachments;
    await wrapper.get(".session-layout").trigger("drop", {
      dataTransfer: {
        types: [PROJECT_ENTRY_DRAG_TYPE],
        getData: () => "invalid",
      },
    });
    await flushPromises();
    expect(inspectProjectAttachments).not.toHaveBeenCalled();
    expect(inspectAttachments).not.toHaveBeenCalled();
  });

  it("ignores drags that do not contain files", async () => {
    const { wrapper } = mountView();
    await wrapper.get(".session-layout").trigger("dragenter", {
      dataTransfer: {
        files: [],
        types: ["text/plain"],
      },
    });

    expect(wrapper.find('[data-slot="attachment-drop-overlay"]').exists()).toBe(
      false,
    );
  });
});
