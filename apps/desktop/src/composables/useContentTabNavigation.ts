import { storeToRefs } from "pinia";
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { PineSessionSummary } from "@/shared/sessions";
import type { ProjectFilePreviewRequest } from "@/shared/projectFiles";
import type { PineAuthoringTarget } from "@/shared/sessionMutators";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useSideChatStore } from "@/stores/sideChat";

const CONTENT_TAB_QUERY = "tab";

export function useContentTabNavigation() {
  const route = useRoute();
  const router = useRouter();
  const store = useContentTabsStore();
  const { tabs } = storeToRefs(store);

  const activeTabId = computed(() => {
    const queryValue = route.query[CONTENT_TAB_QUERY];
    const requestedId = Array.isArray(queryValue) ? queryValue[0] : queryValue;
    if (requestedId && tabs.value.some((tab) => tab.id === requestedId)) {
      return requestedId;
    }
    const fallbackId = store.fallbackActiveTabId;
    if (fallbackId && tabs.value.some((tab) => tab.id === fallbackId)) {
      return fallbackId;
    }
    return (
      tabs.value.find((tab) => tab.kind === "session")?.id ??
      tabs.value[0]?.id ??
      ""
    );
  });

  const activeTab = computed(
    () => tabs.value.find((tab) => tab.id === activeTabId.value) ?? null,
  );
  const activeSessionTab = computed(() =>
    activeTab.value?.kind === "session" ? activeTab.value : null,
  );

  watch(
    () => route.query[CONTENT_TAB_QUERY],
    (queryValue) => {
      const tabId = Array.isArray(queryValue) ? queryValue[0] : queryValue;
      if (tabId) store.setActiveTab(tabId);
    },
    { immediate: true },
  );

  /** Resolves once the route shows the tab. */
  async function navigate(tabId: string, replace = false): Promise<void> {
    if (tabId && !tabs.value.some((tab) => tab.id === tabId)) return;
    store.setActiveTab(tabId);
    const location = {
      query: { ...route.query, [CONTENT_TAB_QUERY]: tabId || undefined },
    };
    await (replace ? router.replace(location) : router.push(location));
  }

  /**
   * The "new session" intent: the active tab is replaced when it is an
   * untouched preview, so browsing then starting a session leaves no stray
   * tab behind. Use `openNewDraft` for an explicit new tab.
   */
  function createSessionTab(options?: { projectId?: string }): void {
    void navigate(
      store.createSessionTab({
        ...options,
        replaceActivePreview: activeTabId.value,
      }).id,
    );
  }

  /** A new draft whose first message starts authoring with Pine. */
  function openCollaborativeDraft(
    projectId: string,
    target: PineAuthoringTarget,
  ): Promise<void> {
    return navigate(
      store.createSessionTab({
        projectId,
        reuseDraft: false,
        mutators: [{ kind: "activate-authoring", target }],
      }).id,
    );
  }

  /**
   * Opens a fresh draft without reusing a draft or replacing a preview tab,
   * and resolves once it shows. Defaults to the latest session activity.
   */
  function openNewDraft(projectId?: string): Promise<void> {
    return navigate(
      store.createSessionTab({ projectId, reuseDraft: false }).id,
    );
  }

  /** `preview` marks a casual open that the next casual open may replace. */
  function openSession(
    session: PineSessionSummary,
    projectId: string,
    options?: { preview?: boolean },
  ): void {
    void navigate(
      store.openSession(session, projectId, activeTabId.value, options).id,
    );
  }

  function openFile(
    file: ProjectFilePreviewRequest,
    options?: { preview?: boolean },
  ): void {
    void navigate(store.openFile(file, options).id);
  }

  function reopenClosedTab(): void {
    const tab = store.reopenClosedTab();
    if (tab) void navigate(tab.id);
  }

  function bindSession(tabId: string, session: PineSessionSummary): void {
    const wasActive = activeTabId.value === tabId;
    const tab = store.bindSession(tabId, session);
    if (tab && wasActive && tab.id !== tabId) {
      void navigate(tab.id, true);
    }
  }

  function failPrompt(tabId: string): void {
    const wasActive = activeTabId.value === tabId;
    const fallbackTabId = store.failPrompt(tabId);
    if (fallbackTabId && wasActive && fallbackTabId !== tabId) {
      void navigate(fallbackTabId, true);
    }
  }

  /**
   * Closes a tab. A conversation's tab takes its side chat with it, asking
   * first when that loses one; declining keeps the tab.
   */
  async function close(tabId: string): Promise<boolean> {
    const tab = tabs.value.find((candidate) => candidate.id === tabId);
    if (
      tab?.kind === "session" &&
      tab.state === "bound" &&
      !(await useSideChatStore().endFor(tab.sessionId))
    )
      return false;
    const currentActiveTabId = activeTabId.value;
    const nextActiveTabId = store.close(tabId, currentActiveTabId);
    if (tabId === currentActiveTabId) void navigate(nextActiveTabId, true);
    return true;
  }

  function removeSession(sessionId: string): void {
    const currentActiveTabId = activeTabId.value;
    const nextActiveTabId = store.removeSession(sessionId, currentActiveTabId);
    if (nextActiveTabId !== currentActiveTabId) {
      void navigate(nextActiveTabId, true);
    }
  }

  return {
    activate: (tabId: string, replace?: boolean): void =>
      void navigate(tabId, replace),
    activeSessionTab,
    activeTab,
    activeTabId,
    bindSession,
    close,
    createSessionTab,
    openCollaborativeDraft,
    openNewDraft,
    failPrompt,
    openFile,
    openSession,
    removeSession,
    reopenClosedTab,
    tabs,
  };
}
