import { PROJECT_ENTRY_DRAG_TYPE } from "@/lib/projectFileDrag";
import { SESSION_DRAG_TYPE } from "@/lib/sessionDrag";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { computed, ref } from "vue";
import { useSessionStore } from "@/stores/session";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useProjectStore } from "@/stores/project";
import { useQuickComposerHandoffStore } from "@/stores/quickComposerHandoff";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { serializeAttachmentMessage } from "@/shared/attachments";
import ProjectSessionView from "../ProjectSessionView.vue";

const activeTabId = ref("session-1");
const navigationTabs = ref([]);
const activateTab = vi.fn();
let followingBottom = true;
/** Views listen on the window, so none may outlive its test. */
const mountedViews: VueWrapper[] = [];

let documentVisibilityStubbed = false;

function setDocumentVisibility(state: "hidden" | "visible"): void {
  documentVisibilityStubbed = true;
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  for (const view of mountedViews.splice(0)) view.unmount();
  if (documentVisibilityStubbed) {
    setDocumentVisibility("visible");
    Reflect.deleteProperty(document, "visibilityState");
    documentVisibilityStubbed = false;
  }
});

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
          name: "MessageScrollerProvider",
          props: ["active"],
          template: "<div><slot /></div>",
          methods: { isFollowingBottom: () => followingBottom },
        },
        MessageScroller: slotStub,
        MessageScrollerViewport: viewportStub,
        MessageScrollerContent: {
          template: '<div><slot /><slot name="tail" /></div>',
        },
        MessageScrollerItem: slotStub,
        PineCharacter: true,
        ProjectSessionComposer: {
          name: "ProjectSessionComposer",
          props: ["attachments", "authoring", "modelValue"],
          template:
            '<div data-slot="composer-stub" :data-attachment-count="attachments?.length ?? 0" :data-authoring="authoring?.join(\',\')" :data-draft="modelValue"><button data-slot="remove-authoring-stub" @click="$emit(\'removeAuthoring\', authoring?.[0])" /><button data-slot="submit-new-stub" @click="$emit(\'submit\', \'Start\')" /><button data-slot="submit-steering-stub" @click="$emit(\'submit\', \'Change direction\')" /></div>',
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
  mountedViews.push(wrapper);
  return { inspectAttachments, wrapper };
}

describe("ProjectSessionView file drop", () => {
  it("reads the session approval preference without writing a default on open", async () => {
    const { wrapper } = mountView();
    const setApprovalMode = vi
      .spyOn(useSessionStore(), "setApprovalMode")
      .mockResolvedValue();
    await wrapper.setProps({ sessionId: "saved-session" });
    useSessionStore().stateFor("saved-session").summary = {
      id: "saved-session",
      createdAt: "",
      updatedAt: "",
      messageCount: 0,
      approvalMode: "let-me-review",
    };
    await flushPromises();
    const composer = wrapper.findComponent({ name: "ProjectSessionComposer" });
    expect(composer.attributes("approvalmode")).toBe("let-me-review");
    expect(setApprovalMode).not.toHaveBeenCalled();
    composer.vm.$emit("update:approvalMode", "YOLO");
    await flushPromises();
    expect(setApprovalMode).toHaveBeenCalledWith("YOLO", "saved-session");
  });

  it("labels a session WeChat started or used", async () => {
    const { wrapper } = mountView();
    const label = () => wrapper.find('[data-slot="session-wechat-origin"]');
    expect(label().exists()).toBe(false);
    await wrapper.setProps({ sessionId: "wechat-session" });
    const summary = {
      id: "wechat-session",
      createdAt: "",
      updatedAt: "",
      messageCount: 0,
    };
    useSessionStore().stateFor("wechat-session").summary = {
      ...summary,
      origin: "wechat",
    };
    await flushPromises();
    expect(label().text()).toBe("来自微信");
    useSessionStore().stateFor("wechat-session").summary = {
      ...summary,
      origin: "wechat-used",
    };
    await flushPromises();
    expect(label().text()).toBe("在微信中使用过");
    useSessionStore().stateFor("wechat-session").summary = summary;
    await flushPromises();
    expect(label().exists()).toBe(false);
  });

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

  it("sends a Create with Pine draft's mutators with its first message", async () => {
    const { wrapper } = mountView();
    const sessionStore = useSessionStore();
    const prompt = vi
      .spyOn(sessionStore, "prompt")
      .mockImplementation(() => new Promise<never>(() => {}));
    const tabs = useContentTabsStore();
    const mutator = { kind: "activate-authoring", target: "mcp" } as const;
    tabs.setDraftMutators("session-1", [mutator]);
    await flushPromises();
    expect(
      wrapper.get('[data-slot="composer-stub"]').attributes("data-authoring"),
    ).toBe("mcp");

    await wrapper.get('[data-slot="submit-new-stub"]').trigger("click");
    await flushPromises();

    expect(prompt).toHaveBeenCalledWith(
      "Start",
      { projectId: "p1", sessionId: undefined },
      "auto-approve",
      undefined,
      [mutator],
    );
    wrapper.unmount();
  });

  it("drops the authoring setup when the user removes its chip", async () => {
    const { wrapper } = mountView();
    const tabs = useContentTabsStore();
    tabs.setDraftMutators("session-1", [
      { kind: "activate-authoring", target: "skill" },
    ]);
    await flushPromises();

    await wrapper.get('[data-slot="remove-authoring-stub"]').trigger("click");

    expect(tabs.mutatorsFor("session-1")).toEqual([]);
    expect(tabs.tabs[0]).not.toHaveProperty("mutators");
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

  it("trims a window that grew while away once its tab is shown again", async () => {
    const { wrapper } = mountView();
    followingBottom = false;
    const state = useSessionStore().stateFor("session-a");
    await wrapper.setProps({ sessionId: "session-a" });
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

    state.messages = transcript(180);
    await flushPromises();
    expect(rendered()).toHaveLength(180);

    // The reader went back to the live end, then left the tab.
    activeTabId.value = "file-tab";
    await flushPromises();
    followingBottom = true;

    activeTabId.value = "session-1";
    await flushPromises();
    expect(rendered()).toHaveLength(60);
    expect(rendered()[0]).toBe("message-120");
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

    await wrapper
      .get('[data-slot="staged-steering-message"]')
      .get('button[aria-label="撤回暂存消息"]')
      .trigger("click");
    await flushPromises();

    const composer = wrapper.get('[data-slot="composer-stub"]');
    expect(composer.attributes("data-draft")).toBe("Change direction");
    expect(composer.attributes("data-attachment-count")).toBe("1");
  });

  it("asks the session to send a staged steering message now", async () => {
    const { wrapper } = mountView();
    const sessionStore = useSessionStore().stateFor("session-a");
    await wrapper.setProps({ sessionId: "session-a" });
    const sendSteeringNow = vi.fn().mockResolvedValue({ sent: true });
    window.pine.sendSteeringNow = sendSteeringNow;
    sessionStore.steeringMessages = ["Change direction"];
    await flushPromises();

    await wrapper
      .get('[data-slot="staged-steering-message"]')
      .get('button[aria-label="立即发送暂存消息"]')
      .trigger("click");
    await flushPromises();

    expect(sendSteeringNow).toHaveBeenCalledWith({
      message: "Change direction",
      sessionId: "session-a",
    });
    expect(
      wrapper.get('[data-slot="composer-stub"]').attributes("data-draft"),
    ).toBe("");
  });

  it("stages steering above the status cards, which then drop their top gap", async () => {
    const { wrapper } = mountView();
    const sessionStore = useSessionStore().stateFor("session-a");
    await wrapper.setProps({ sessionId: "session-a" });
    sessionStore.steeringMessages = ["Change direction"];
    // The status row only renders when it has something to show.
    sessionStore.todos = {
      nextId: 1,
      tasks: [{ id: 1, subject: "Task", status: "pending" }],
    };
    await flushPromises();

    const staged = wrapper.get('[data-slot="staged-steering-messages"]');
    const statusRegion = staged.element.nextElementSibling as HTMLElement;
    expect(
      statusRegion.querySelector('[data-testid="project-session-status"]'),
    ).toBeTruthy();
    expect(
      wrapper.get("[data-testid=project-status-card-row]").classes(),
    ).toContain("pt-3");

    sessionStore.steeringMessages = [];
    await flushPromises();
    expect(
      wrapper.get("[data-testid=project-status-card-row]").classes(),
    ).toContain("pt-8");
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

  it("holds the transcript of a hidden window and catches up when shown", async () => {
    const { wrapper } = mountView();
    const state = useSessionStore().stateFor("session-a");
    await wrapper.setProps({ sessionId: "session-a" });
    const message = (id: string, text: string) => ({
      id,
      createdAt: "2026-09-03T00:00:00Z",
      role: "assistant" as const,
      status: "complete" as const,
      blocks: [{ type: "text" as const, text }],
    });
    state.messages = [message("first-message", "First")];
    await flushPromises();
    const scroller = () =>
      wrapper.findComponent({ name: "MessageScrollerProvider" });
    const renderedIds = () =>
      wrapper
        .findAllComponents({ name: "ProjectTranscriptMessage" })
        .map((row) => row.props("message").id);
    expect(scroller().props("active")).toBe(true);

    setDocumentVisibility("hidden");
    state.messages = [...state.messages, message("second-message", "Second")];
    await flushPromises();
    expect(scroller().props("active")).toBe(false);
    expect(renderedIds()).toEqual(["first-message"]);

    setDocumentVisibility("visible");
    await flushPromises();
    expect(scroller().props("active")).toBe(true);
    expect(renderedIds()).toEqual(["first-message", "second-message"]);
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

describe("ProjectSessionView awaiting-response marker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows while the sent message waits for its first content", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { wrapper } = mountView();
    const sessionId = "019cfe51-7166-79b9-a5b9-c652fcca9eac";
    await wrapper.setProps({ sessionId });
    const state = useSessionStore().stateFor(sessionId);
    const prompt = {
      id: "prompt",
      createdAt: "2026-11-13T00:00:00Z",
      role: "user" as const,
      status: "complete" as const,
      blocks: [{ type: "text" as const, text: "Hello" }],
    };
    state.messages = [prompt];
    state.isRunning = true;
    await flushPromises();
    const marker = '[data-testid="awaiting-response-marker"]';
    vi.advanceTimersByTime(2999);
    await flushPromises();
    expect(wrapper.find(marker).exists()).toBe(false);
    vi.advanceTimersByTime(1);
    await flushPromises();
    expect(wrapper.find(marker).exists()).toBe(true);

    // The first content takes it away.
    state.messages = [
      prompt,
      {
        id: "reply",
        createdAt: "2026-11-13T00:00:01Z",
        role: "assistant",
        status: "streaming",
        blocks: [{ type: "text", text: "Hi" }],
      },
    ];
    await flushPromises();
    expect(wrapper.find(marker).exists()).toBe(false);

    // A follow-up waits again; the run ending before any content ends it.
    state.messages = [...state.messages, { ...prompt, id: "follow-up" }];
    await flushPromises();
    vi.advanceTimersByTime(3000);
    await flushPromises();
    expect(wrapper.find(marker).exists()).toBe(true);
    state.isRunning = false;
    await flushPromises();
    expect(wrapper.find(marker).exists()).toBe(false);
  });
});

describe("ProjectSessionView Esc interrupt", () => {
  async function mountRunningView() {
    const { wrapper } = mountView();
    const sessionStore = useSessionStore();
    const runningSession = {
      id: "019cfe51-7166-79b9-a5b9-c652fcca9eab",
      createdAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:00.000Z",
      messageCount: 1,
    };
    const abortSession = vi.fn().mockResolvedValue(undefined);
    window.pine.loadSessionMessages = vi.fn().mockResolvedValue({
      hasMore: false,
      messages: [],
    });
    window.pine.resumeSession = vi.fn().mockResolvedValue({
      session: runningSession,
    });
    window.pine.abortSession = abortSession;
    await sessionStore.resume("p1", runningSession.id);
    await wrapper.setProps({ sessionId: runningSession.id });
    sessionStore.isRunning = true;
    await flushPromises();
    return { abortSession, sessionId: runningSession.id };
  }

  function pressEscape(init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
      ...init,
    });
    window.dispatchEvent(event);
    return event;
  }

  it("interrupts the running turn of the visible conversation", async () => {
    const { abortSession, sessionId } = await mountRunningView();

    const event = pressEscape();

    expect(event.defaultPrevented).toBe(true);
    expect(abortSession).toHaveBeenCalledWith({ sessionId });
  });

  it("leaves Esc to open overlays, IME composition, and hidden tabs", async () => {
    const { abortSession } = await mountRunningView();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.dataset.state = "open";
    document.body.append(dialog);

    pressEscape();
    dialog.remove();
    pressEscape({ isComposing: true });
    activeTabId.value = "session-2";
    await flushPromises();
    pressEscape();

    expect(abortSession).not.toHaveBeenCalled();
  });

  it("does nothing while idle", async () => {
    const { abortSession } = await mountRunningView();
    useSessionStore().isRunning = false;
    await flushPromises();

    pressEscape();

    expect(abortSession).not.toHaveBeenCalled();
  });
});

describe("ProjectSessionView floating composer handoff", () => {
  it("opens the chosen project before its draft moves there", async () => {
    const { wrapper } = mountView();
    const projectStore = useProjectStore();
    const contentTabsStore = useContentTabsStore();
    const present = vi.fn().mockResolvedValue(undefined);
    Object.assign(window.pine, { presentQuickComposerHandoff: present });
    let openWhenMoved: boolean | undefined;
    contentTabsStore.$subscribe(() => {
      const tab = contentTabsStore.tabs.find(({ id }) => id === "session-1");
      if (tab?.projectId === "courses" && openWhenMoved === undefined)
        openWhenMoved = projectStore.isOpen("courses");
    });

    useQuickComposerHandoffStore().deliver({
      message: "Hello",
      approvalMode: "auto-approve",
      projectId: "courses",
      context: [],
    });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 60));
    await flushPromises();

    expect(window.pine.openProject).toHaveBeenCalledWith({ id: "courses" });
    expect(openWhenMoved).toBe(true);
    expect(present).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("sends the floating composer's context ahead of the message", async () => {
    const { wrapper } = mountView();
    const sessionStore = useSessionStore();
    const prompt = vi
      .spyOn(sessionStore, "prompt")
      .mockResolvedValue(undefined as never);
    Object.assign(window.pine, {
      presentQuickComposerHandoff: vi.fn().mockResolvedValue(undefined),
    });
    const context = {
      extension: "png",
      kind: "file" as const,
      modifiedAt: "2026-10-30T00:00:00.000Z",
      name: "Notes.png",
      path: "/tmp/notes.png",
      size: 10,
      source: { app: "Notes" },
    };

    useQuickComposerHandoffStore().deliver({
      message: "Hello",
      approvalMode: "auto-approve",
      projectId: "p1",
      context: [context],
    });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 60));
    await flushPromises();

    expect(prompt).toHaveBeenCalledWith(
      serializeAttachmentMessage([context], "Hello"),
      expect.anything(),
      "auto-approve",
    );
    wrapper.unmount();
  });
});
