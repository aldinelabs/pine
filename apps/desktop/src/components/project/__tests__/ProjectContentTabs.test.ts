import {
  DOMWrapper,
  enableAutoUnmount,
  flushPromises,
  mount,
} from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { computed, nextTick, onUnmounted, shallowRef } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import {
  WINDOW_TAB_CLOSE_HANDLER_KEY,
  type WindowTabCloseHandler,
} from "@/composables/useWindowTabShortcuts";
import { PINE_RELEASES_URL, PINE_REPOSITORY_URL } from "@/shared/window";
import type { PineSessionSummary } from "@/shared/sessions";
import { useSessionStore } from "@/stores/session";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useProjectRightSidebarStore } from "@/stores/projectRightSidebar";
import {
  CONTENT_TAB_DRAG_TYPE,
  FILE_TAB_DRAG_TYPE,
} from "@/lib/contentTabDrag";
import { SESSION_DRAG_TYPE } from "@/lib/sessionDrag";
import ProjectContentTabs from "../ProjectContentTabs.vue";

const sidebar = vi.hoisted(() => ({
  state: "expanded",
  isMobile: false,
}));
const sessionView = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));
enableAutoUnmount(afterEach);

/** Session-event listeners the mounted tabs registered, for driving events. */
let sessionEventListeners: ((event: unknown) => void)[] = [];

vi.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({
    state: computed(() => sidebar.state),
    isMobile: computed(() => sidebar.isMobile),
  }),
}));

vi.mock("../ProjectSessionView.vue", () => ({
  default: {
    props: ["tabId"],
    setup() {
      sessionView.mounts += 1;
      onUnmounted(() => {
        sessionView.unmounts += 1;
      });
    },
    template:
      '<div :data-session-view="tabId"><textarea /><div data-scroll /></div>',
  },
}));

async function mountTabs(withFile = false) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: { template: "<div />" } }],
  });
  await router.push({ path: "/", query: { tab: "session-1" } });
  await router.isReady();
  sessionView.mounts = 0;
  sessionView.unmounts = 0;
  sessionEventListeners = [];
  const closeTabHandler = shallowRef<WindowTabCloseHandler | null>(null);
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      getAppVersion: vi.fn().mockResolvedValue("0.1.0"),
      exportSession: vi.fn().mockResolvedValue({
        path: "/tmp/First prompt.md",
        saved: true,
      }),
      onSessionEvent: vi.fn().mockImplementation((listener) => {
        sessionEventListeners.push(listener);
        return () => undefined;
      }),
      openExternalUrl: vi.fn().mockResolvedValue(undefined),
      readProjectFilePreview: vi.fn().mockResolvedValue({
        kind: "text",
        text: "const n = 1;",
        size: 12,
        modifiedAt: "2026-09-04T12:00:00Z",
        encoding: "UTF-8",
      }),
      loadSessionMessages: vi.fn().mockResolvedValue({
        hasMore: false,
        messages: [],
      }),
      resumeSession: vi.fn(({ sessionId }) =>
        Promise.resolve({
          session: sessionId === firstSession.id ? firstSession : secondSession,
        }),
      ),
    },
  });
  const file = withFile
    ? useContentTabsStore().openFile({
        projectId: "p1",
        folderId: "f1",
        relativePath: "example.ts",
      })
    : null;
  const wrapper = mount(ProjectContentTabs, {
    attachTo: document.body,
    global: {
      plugins: [pinia, router, createAppI18n("en-US")],
      provide: {
        [WINDOW_TAB_CLOSE_HANDLER_KEY as symbol]: closeTabHandler,
      },
    },
  });
  return { router, wrapper, file, closeTabHandler };
}

const firstSession: PineSessionSummary = {
  createdAt: "2026-08-25T00:00:00.000Z",
  id: "019cfe51-7166-79b9-a5b9-c652fcca9eab",
  messageCount: 2,
  preview: "First prompt",
  updatedAt: "2026-08-25T00:01:00.000Z",
};

const secondSession: PineSessionSummary = {
  ...firstSession,
  id: "019cfe51-7166-79b9-a5b9-c652fcca9eac",
  preview: "Second prompt",
};

describe("ProjectContentTabs", () => {
  it("retains connected session and file scrollports and drafts across activation and reorder", async () => {
    const { wrapper, router, file } = await mountTabs(true);
    const store = useContentTabsStore();
    const first = wrapper.get<HTMLElement>(
      '[data-session-view="session-1"] [data-scroll]',
    ).element;
    first.scrollTop = 310;
    await wrapper
      .get('[data-session-view="session-1"] textarea')
      .setValue("draft one");
    const second = store.createSessionTab({ reuseDraft: false });
    await router.push({ query: { tab: second.id } });
    await flushPromises();
    const secondScroll = wrapper.get<HTMLElement>(
      `[data-session-view="${second.id}"] [data-scroll]`,
    ).element;
    secondScroll.scrollTop = 640;

    await router.push({ query: { tab: file!.id } });
    await flushPromises();
    const fileScroll = wrapper.get<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    ).element;
    fileScroll.scrollTop = 480;
    fileScroll.scrollLeft = 120;
    await router.push({ query: { tab: "session-1" } });
    await flushPromises();
    store.moveTab("session-1", file!.id, "after");
    await nextTick();
    expect(first.isConnected).toBe(true);
    expect(secondScroll.isConnected).toBe(true);
    expect(fileScroll.isConnected).toBe(true);
    expect(first.scrollTop).toBe(310);
    expect(
      wrapper.get<HTMLTextAreaElement>(
        '[data-session-view="session-1"] textarea',
      ).element.value,
    ).toBe("draft one");
    expect(
      wrapper.findAll('[role="tabpanel"]:not([aria-hidden])'),
    ).toHaveLength(1);

    await router.push({ query: { tab: second.id } });
    await flushPromises();
    expect(secondScroll.scrollTop).toBe(640);
    await router.push({ query: { tab: file!.id } });
    await flushPromises();
    expect(fileScroll.scrollTop).toBe(480);
    expect(fileScroll.scrollLeft).toBe(120);
    expect(window.pine.readProjectFilePreview).toHaveBeenCalledTimes(1);
  });

  it("reorders dragged tabs without switching selection and marks files for attachment drops", async () => {
    const { router, wrapper, file } = await mountTabs(true);
    const data = new Map<string, string>();
    const transfer = {
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? "",
      effectAllowed: "none",
      dropEffect: "none",
    };
    const source = wrapper.get(`[data-tab-id="${file!.id}"]`);
    const target = wrapper.get('[data-tab-id="session-1"]');
    vi.spyOn(target.element, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 160, 32),
    );
    await source.trigger("dragstart", { dataTransfer: transfer });
    expect(data.get(CONTENT_TAB_DRAG_TYPE)).toBe(file!.id);
    expect(data.get(FILE_TAB_DRAG_TYPE)).toBe(file!.id);
    expect(transfer.effectAllowed).toBe("copyMove");
    await target.trigger("dragover", { dataTransfer: transfer, clientX: 10 });
    await target.trigger("drop", { dataTransfer: transfer });
    await flushPromises();
    expect(useContentTabsStore().tabs.map((tab) => tab.id)).toEqual([
      file!.id,
      "session-1",
    ]);
    expect(router.currentRoute.value.query.tab).toBe("session-1");
    wrapper.unmount();
  });

  it("marks bound session tabs for conversation attachment drops", async () => {
    const { wrapper } = await mountTabs();
    useContentTabsStore().bindSession("session-1", firstSession);
    await flushPromises();
    const data = new Map<string, string>();
    const transfer = {
      setData: (type: string, value: string) => data.set(type, value),
      effectAllowed: "none",
    };

    await wrapper
      .get('[data-tab-id="session-1"]')
      .trigger("dragstart", { dataTransfer: transfer });

    expect(data.get(SESSION_DRAG_TYPE)).toBe(firstSession.id);
    expect(transfer.effectAllowed).toBe("copyMove");
    wrapper.unmount();
  });

  it("keeps the tab titlebar draggable while making the complete tab strip scrollable", async () => {
    const { wrapper } = await mountTabs(true);

    expect(
      wrapper.get('[data-slot="project-content-tabs-titlebar"]').classes(),
    ).toContain("window-drag");
    expect(
      wrapper.get('[data-slot="project-content-tabs-titlebar"]').classes(),
    ).not.toContain("pointer-events-none");
    expect(
      wrapper.get('[data-slot="project-content-tab-items"]').classes(),
    ).toContain("window-drag");
    expect(
      wrapper.get('[data-slot="project-content-tab"]').classes(),
    ).toContain("window-no-drag");
    expect(
      wrapper.get('[data-slot="project-content-tab-drag-space"]').classes(),
    ).toContain("window-drag");
    expect(wrapper.get(".project-content-tab-separator").classes()).toContain(
      "window-no-drag",
    );

    wrapper.unmount();
  });

  it("moves tab actions to the edge while the right sidebar is open", async () => {
    const { wrapper } = await mountTabs();
    const rightSidebar = useProjectRightSidebarStore();
    rightSidebar.setOpen(false);
    await nextTick();
    const titlebar = () =>
      wrapper.get('[data-slot="project-content-tabs-titlebar"]').classes();
    const reserved =
      "pr-[calc(var(--window-titlebar-controls-width)+var(--window-titlebar-trailing-actions-width))]";

    expect(titlebar()).toContain(reserved);

    rightSidebar.setOpen(true);
    await nextTick();

    expect(titlebar()).not.toContain(reserved);
    expect(titlebar()).toContain("pr-3");
    wrapper.unmount();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps separate file previews cached when switching between tabs", async () => {
    const { router, wrapper, file } = await mountTabs(true);
    const store = useContentTabsStore();
    const second = store.openFile({
      projectId: "p1",
      folderId: "f1",
      relativePath: "second.txt",
    });
    await router.push({ query: { tab: file!.id } });
    await flushPromises();
    expect(
      wrapper
        .get('[role="tabpanel"]:not([aria-hidden]) section')
        .attributes("aria-label"),
    ).toBe("example.ts");
    await router.push({ query: { tab: second.id } });
    await flushPromises();
    expect(
      wrapper
        .get('[role="tabpanel"]:not([aria-hidden]) section')
        .attributes("aria-label"),
    ).toBe("second.txt");
    await router.push({ query: { tab: file!.id } });
    await flushPromises();
    expect(window.pine.readProjectFilePreview).toHaveBeenCalledTimes(2);
    await wrapper.get('button[aria-label="Close example.ts"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.tab).toBe(second.id);
    expect(
      wrapper
        .get('[role="tabpanel"]:not([aria-hidden]) section')
        .attributes("aria-label"),
    ).toBe("second.txt");
    wrapper.unmount();
  });

  it.each([
    { name: "right-clipped", left: 500, target: 520 },
    { name: "left-clipped", left: 20, target: 40 },
    { name: "visible", left: 120, target: null },
  ])("reveals a $name tab on route activation", async ({ left, target }) => {
    const { router, wrapper, file } = await mountTabs(true);
    const viewport = wrapper.get<HTMLDivElement>('[role="tablist"]').element;
    const button = wrapper.get<HTMLButtonElement>(
      `#project-content-tab-${file!.id}`,
    ).element;
    Object.defineProperties(viewport, {
      clientWidth: { value: 320 },
      scrollWidth: { value: 1000 },
      scrollLeft: { value: 200, writable: true },
    });
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(
      new DOMRect(100, 0, 320, 40),
    );
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue(
      new DOMRect(left, 0, 160, 32),
    );
    const scroll = vi.spyOn(viewport, "scrollTo").mockImplementation(() => {});

    await router.push({ query: { tab: file!.id } });
    await flushPromises();

    if (target === null) {
      expect(scroll).not.toHaveBeenCalled();
    } else {
      expect(scroll).toHaveBeenCalledExactlyOnceWith({
        left: target,
        behavior: "smooth",
      });
    }
    wrapper.unmount();
  });

  it("reveals keyboard-selected tabs without focus scrolling and respects reduced motion", async () => {
    const { wrapper, file } = await mountTabs(true);
    const viewport = wrapper.get<HTMLDivElement>('[role="tablist"]').element;
    const button = wrapper.get<HTMLButtonElement>(
      `#project-content-tab-${file!.id}`,
    ).element;
    Object.defineProperties(viewport, {
      clientWidth: { value: 200 },
      scrollWidth: { value: 400 },
    });
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 200, 40),
    );
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue(
      new DOMRect(240, 0, 160, 32),
    );
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
    } as MediaQueryList);
    const scroll = vi.spyOn(viewport, "scrollTo").mockImplementation(() => {});
    const focus = vi.spyOn(button, "focus");

    await wrapper.get('[role="tab"]').trigger("keydown", { key: "End" });
    await flushPromises();

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scroll).toHaveBeenCalledExactlyOnceWith({
      left: 200,
      behavior: "instant",
    });
    wrapper.unmount();
  });

  it("clears the tab list fade after closing a tab removes overflow", async () => {
    const { wrapper } = await mountTabs();
    const tabsStore = useContentTabsStore();
    const viewport = wrapper.get<HTMLDivElement>('[role="tablist"]').element;
    let scrollOffset = 0;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 300 },
      scrollWidth: {
        configurable: true,
        get: () =>
          wrapper.findAll('[data-slot="project-content-tab"]').length * 160,
      },
      scrollLeft: {
        configurable: true,
        get: () =>
          Math.min(scrollOffset, Math.max(0, viewport.scrollWidth - 300)),
        set: (value: number) => {
          scrollOffset = value;
        },
      },
    });

    const secondTab = tabsStore.createSessionTab({ reuseDraft: false });
    await nextTick();
    await flushPromises();
    expect(viewport.classList.contains("scroll-fade-none")).toBe(false);
    viewport.scrollLeft = 20;
    const firstTab = wrapper.get<HTMLElement>(
      '[data-tab-id="session-1"]',
    ).element;
    vi.spyOn(firstTab, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(100 - viewport.scrollLeft, 0, 160, 32),
    );
    const animate = vi.fn();
    firstTab.animate = animate;

    await wrapper
      .get(
        `[data-tab-id="${secondTab.id}"] button[aria-label="Close New session"]`,
      )
      .trigger("click");
    await flushPromises();
    expect(viewport.classList.contains("scroll-fade-none")).toBe(true);
    expect(animate).toHaveBeenCalledWith(
      [{ transform: "translateX(-20px)" }, { transform: "translateX(0)" }],
      expect.objectContaining({ duration: 320 }),
    );
    wrapper.unmount();
  });

  it("animates surviving tabs when the last tab closes and overflow remains", async () => {
    const { wrapper } = await mountTabs();
    const tabsStore = useContentTabsStore();
    const viewport = wrapper.get<HTMLDivElement>('[role="tablist"]').element;
    let scrollOffset = 240;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 200 },
      scrollWidth: {
        configurable: true,
        get: () =>
          wrapper.findAll('[data-slot="project-content-tab"]').length * 160,
      },
      scrollLeft: {
        configurable: true,
        get: () =>
          Math.min(scrollOffset, Math.max(0, viewport.scrollWidth - 200)),
        set: (value: number) => {
          scrollOffset = value;
        },
      },
    });
    tabsStore.createSessionTab({ reuseDraft: false });
    const lastTab = tabsStore.createSessionTab({ reuseDraft: false });
    await flushPromises();
    const firstTab = wrapper.get<HTMLElement>(
      '[data-tab-id="session-1"]',
    ).element;
    vi.spyOn(firstTab, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(100 - viewport.scrollLeft, 0, 160, 32),
    );
    const animate = vi.fn();
    firstTab.animate = animate;

    await wrapper
      .get(
        `[data-tab-id="${lastTab.id}"] button[aria-label="Close New session"]`,
      )
      .trigger("click");
    await flushPromises();

    expect(viewport.scrollWidth).toBe(320);
    expect(animate).toHaveBeenCalledWith(
      [{ transform: "translateX(-120px)" }, { transform: "translateX(0)" }],
      expect.objectContaining({ duration: 320 }),
    );
    wrapper.unmount();
  });

  it("animates tabs closed through the window shortcut handler", async () => {
    const { wrapper, closeTabHandler } = await mountTabs();
    const tabsStore = useContentTabsStore();
    const viewport = wrapper.get<HTMLDivElement>('[role="tablist"]').element;
    let scrollOffset = 20;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 300 },
      scrollWidth: {
        configurable: true,
        get: () =>
          wrapper.findAll('[data-slot="project-content-tab"]').length * 160,
      },
      scrollLeft: {
        configurable: true,
        get: () =>
          Math.min(scrollOffset, Math.max(0, viewport.scrollWidth - 300)),
        set: (value: number) => {
          scrollOffset = value;
        },
      },
    });

    const secondTab = tabsStore.createSessionTab({ reuseDraft: false });
    await flushPromises();
    const firstTab = wrapper.get<HTMLElement>(
      '[data-tab-id="session-1"]',
    ).element;
    vi.spyOn(firstTab, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(100 - viewport.scrollLeft, 0, 160, 32),
    );
    const animate = vi.fn();
    firstTab.animate = animate;

    closeTabHandler.value?.(secondTab.id);
    await flushPromises();

    expect(animate).toHaveBeenCalledWith(
      [{ transform: "translateX(-20px)" }, { transform: "translateX(0)" }],
      expect.objectContaining({ duration: 320 }),
    );
    wrapper.unmount();
  });

  it("animates tabs closed when navigation mutates the tab store outside clicks", async () => {
    const { wrapper } = await mountTabs();
    const tabsStore = useContentTabsStore();
    const viewport = wrapper.get<HTMLDivElement>('[role="tablist"]').element;
    let scrollOffset = 20;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 300 },
      scrollWidth: {
        configurable: true,
        get: () =>
          wrapper.findAll('[data-slot="project-content-tab"]').length * 160,
      },
      scrollLeft: {
        configurable: true,
        get: () =>
          Math.min(scrollOffset, Math.max(0, viewport.scrollWidth - 300)),
        set: (value: number) => {
          scrollOffset = value;
        },
      },
    });

    const secondTab = tabsStore.createSessionTab({ reuseDraft: false });
    await flushPromises();
    const firstTab = wrapper.get<HTMLElement>(
      '[data-tab-id="session-1"]',
    ).element;
    vi.spyOn(firstTab, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(100 - viewport.scrollLeft, 0, 160, 32),
    );
    const animate = vi.fn();
    firstTab.animate = animate;

    tabsStore.close(secondTab.id, "session-1");
    await flushPromises();

    expect(animate).toHaveBeenCalledWith(
      [{ transform: "translateX(-20px)" }, { transform: "translateX(0)" }],
      expect.objectContaining({ duration: 320 }),
    );
    wrapper.unmount();
  });

  it("binds each session tab to its own session and reuses its view", async () => {
    const { router, wrapper } = await mountTabs();
    const tabsStore = useContentTabsStore();
    tabsStore.bindSession("session-1", firstSession);
    await nextTick();

    await wrapper.get('button[aria-label="Add session tab"]').trigger("click");
    await flushPromises();
    const secondTabId = String(router.currentRoute.value.query.tab);
    tabsStore.bindSession(secondTabId, secondSession);
    await flushPromises();

    const tabLabels = wrapper
      .findAll('[role="tab"]')
      .map((trigger) => trigger.text());
    expect(tabLabels).toContain("First prompt");
    expect(tabLabels).toContain("Second prompt");
    expect(sessionView.mounts).toBe(2);

    await wrapper.findAll('[role="tab"]')[0].trigger("click");
    await flushPromises();
    expect(window.pine.resumeSession).toHaveBeenCalledWith({
      sessionId: firstSession.id,
    });
    expect(sessionView.mounts).toBe(2);
    wrapper.unmount();
  });

  it("selects exactly one newly created session tab and switches its panel", async () => {
    const { router, wrapper } = await mountTabs();
    const tabsStore = useContentTabsStore();
    tabsStore.bindSession("session-1", firstSession);
    await nextTick();

    await wrapper.get('button[aria-label="Add session tab"]').trigger("click");
    await flushPromises();

    const selectedTabs = wrapper
      .findAll('[role="tab"]')
      .filter((tab) => tab.attributes("aria-selected") === "true");
    const selectedId = String(router.currentRoute.value.query.tab);
    expect(selectedTabs).toHaveLength(1);
    expect(selectedTabs[0].attributes("id")).toBe(
      `project-content-tab-${selectedId}`,
    );
    expect(selectedId).not.toBe("session-1");
    expect(
      wrapper.get('[role="tabpanel"]:not([aria-hidden])').attributes("id"),
    ).toBe(`project-content-panel-${selectedId}`);
  });

  it("closes directly to the next draft without briefly resuming the first tab", async () => {
    const { router, wrapper } = await mountTabs();
    const store = useContentTabsStore();
    store.bindSession("session-1", firstSession);
    await flushPromises();
    const second = store.openSession(secondSession);
    await router.push({ query: { tab: second.id } });
    await flushPromises();
    const draft = store.createSessionTab();
    await flushPromises();
    const resume = vi.spyOn(useSessionStore(), "resume");

    await wrapper
      .get('button[aria-label="Close Second prompt"]')
      .trigger("click");
    await flushPromises();

    expect(router.currentRoute.value.query.tab).toBe(draft.id);
    expect(resume).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("releases a closed background view and its transcript cache", async () => {
    const { router, wrapper } = await mountTabs();
    const store = useContentTabsStore();
    store.bindSession("session-1", firstSession);
    await flushPromises();
    const second = store.openSession(secondSession);
    await router.push({ query: { tab: second.id } });
    await flushPromises();
    const resume = vi.spyOn(useSessionStore(), "resume");
    const loadMessages = vi.mocked(window.pine.loadSessionMessages);
    loadMessages.mockClear();

    await wrapper
      .get('button[aria-label="Close First prompt"]')
      .trigger("click");
    await flushPromises();

    expect(router.currentRoute.value.query.tab).toBe(second.id);
    expect(sessionView.unmounts).toBe(1);
    expect(resume).not.toHaveBeenCalled();
    const reopened = store.openSession(firstSession);
    await router.push({ query: { tab: reopened.id } });
    await flushPromises();
    expect(loadMessages).toHaveBeenCalledExactlyOnceWith({
      includeOutline: true,
      sessionId: firstSession.id,
      limit: 50,
    });
    wrapper.unmount();
  });

  it("releases closed views instead of accumulating retained panels", async () => {
    const { wrapper } = await mountTabs();
    for (let index = 0; index < 5; index += 1) {
      await wrapper
        .get('button[aria-label="Close New session"]')
        .trigger("click");
      await flushPromises();
      expect(sessionView.mounts - sessionView.unmounts).toBe(0);
      await wrapper
        .get('button[aria-label="Add session tab"]')
        .trigger("click");
      await flushPromises();
    }
    wrapper.unmount();
  });

  it("shows an empty placeholder after closing the final tab and can open a new one", async () => {
    const { router, wrapper } = await mountTabs();
    await wrapper
      .get('button[aria-label="Close New session"]')
      .trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.tab).toBeUndefined();
    expect(useContentTabsStore().tabs).toEqual([]);
    expect(
      wrapper.find('[role="region"][aria-label="No tabs open"]').exists(),
    ).toBe(true);
    const logo = wrapper.get('[role="region"][aria-label="No tabs open"] svg');
    expect(logo.find("path").exists()).toBe(true);
    expect(wrapper.find('[data-slot="empty"]').exists()).toBe(false);
    expect(wrapper.find('[role="tabpanel"]').exists()).toBe(false);
    await flushPromises();
    expect(wrapper.get('[data-testid="pine-version"]').text()).toBe(
      "Version 0.1.0",
    );
    await wrapper.get('button[aria-label="Add session tab"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[role="tabpanel"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("trails the new-tab button after the last tab and docks it once it scrolls out of view", async () => {
    const observers: {
      callback: IntersectionObserverCallback;
      targets: Element[];
    }[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        entry = { callback: undefined as never, targets: [] as Element[] };
        constructor(callback: IntersectionObserverCallback) {
          this.entry.callback = callback as never;
          observers.push(this.entry);
        }
        observe(target: Element) {
          this.entry.targets.push(target);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    try {
      const { wrapper } = await mountTabs();
      useContentTabsStore().bindSession("session-1", firstSession);
      await flushPromises();
      const trailing = '[data-slot="project-content-add-tab-trailing"]';
      const docked = '[data-slot="project-content-add-tab-docked"]';
      expect(
        wrapper
          .get('[data-slot="project-content-tab-items"]')
          .find(trailing)
          .exists(),
      ).toBe(true);
      expect(wrapper.find(docked).exists()).toBe(false);

      const observer = observers.find((entry) =>
        entry.targets.includes(wrapper.get(trailing).element),
      );
      expect(observer).toBeDefined();
      observer?.callback(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      await nextTick();
      expect(wrapper.find(docked).exists()).toBe(true);

      await wrapper.get(docked).trigger("click");
      await flushPromises();
      expect(wrapper.findAll('[role="tab"]')).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("opens the project repository in the system browser from the empty state", async () => {
    const { wrapper } = await mountTabs();
    await wrapper
      .get('button[aria-label="Close New session"]')
      .trigger("click");
    await flushPromises();
    const github = wrapper.get('button[aria-label="Open GitHub repository"]');
    expect(github.find("svg").exists()).toBe(true);
    await github.trigger("click");
    await flushPromises();
    expect(window.pine.openExternalUrl).toHaveBeenCalledWith(
      PINE_REPOSITORY_URL,
    );
    wrapper.unmount();
  });

  it("opens the project releases page from the version button", async () => {
    const { wrapper } = await mountTabs();
    await wrapper
      .get('button[aria-label="Close New session"]')
      .trigger("click");
    await flushPromises();
    const version = wrapper.get('[data-testid="pine-version"]');
    expect(version.element.tagName).toBe("BUTTON");
    await version.trigger("click");
    await flushPromises();
    expect(window.pine.openExternalUrl).toHaveBeenCalledWith(PINE_RELEASES_URL);
    wrapper.unmount();
  });

  it("exports the active session from the top-right actions menu", async () => {
    const { wrapper } = await mountTabs();
    const tabsStore = useContentTabsStore();
    tabsStore.bindSession("session-1", firstSession);
    await flushPromises();

    const exportSession = vi.mocked(window.pine.exportSession);
    await wrapper.get('button[aria-label="More actions"]').trigger("click");
    await flushPromises();
    const exportAction = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("Export conversation"));
    expect(exportAction).toBeDefined();
    if (!exportAction) throw new Error("Export action was not rendered.");
    await new DOMWrapper(exportAction).trigger("click");
    await flushPromises();

    expect(exportSession).toHaveBeenCalledWith({ sessionId: firstSession.id });
    wrapper.unmount();
  });

  it("flashes a presented file tab until the user hovers or opens it", async () => {
    const { wrapper, router } = await mountTabs();
    const store = useContentTabsStore();

    for (const listener of sessionEventListeners) {
      listener({
        type: "present-file",
        sessionId: firstSession.id,
        toolCallId: "tool-1",
        path: "/tmp/report.pdf",
        target: { source: "presented", path: "/tmp/report.pdf" },
      });
    }
    await flushPromises();

    const tab = store.tabs.at(-1)!;
    const element = wrapper.get<HTMLElement>(
      `[data-tab-id="${tab.id}"]`,
    ).element;
    expect(element.classList.contains("attention-flash")).toBe(true);
    // The active session tab is untouched: presenting must not steal focus.
    expect(router.currentRoute.value.query.tab).toBe("session-1");

    await wrapper.get(`[data-tab-id="${tab.id}"]`).trigger("pointerenter");
    expect(element.classList.contains("attention-flash")).toBe(false);

    // Presenting again re-arms the signal, and opening the tab clears it.
    for (const listener of sessionEventListeners) {
      listener({
        type: "present-file",
        sessionId: firstSession.id,
        toolCallId: "tool-2",
        path: "/tmp/report.pdf",
        target: { source: "presented", path: "/tmp/report.pdf" },
      });
    }
    await flushPromises();
    expect(element.classList.contains("attention-flash")).toBe(true);

    await router.push({ query: { tab: tab.id } });
    await flushPromises();
    expect(element.classList.contains("attention-flash")).toBe(false);
    wrapper.unmount();
  });
});
