import { storeToRefs } from "pinia";
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { PineSessionSummary } from "@/shared/sessions";
import type { ProjectFilePreviewRequest } from "@/shared/projectFiles";
import { useContentTabsStore } from "@/stores/contentTabs";

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

  function navigate(tabId: string, replace = false): void {
    if (tabId && !tabs.value.some((tab) => tab.id === tabId)) return;
    store.setActiveTab(tabId);
    const location = {
      query: { ...route.query, [CONTENT_TAB_QUERY]: tabId || undefined },
    };
    void (replace ? router.replace(location) : router.push(location));
  }

  function createSessionTab(options?: { projectId?: string }): void {
    navigate(store.createSessionTab(options).id);
  }

  function openSession(session: PineSessionSummary, projectId: string): void {
    navigate(store.openSession(session, projectId, activeTabId.value).id);
  }

  function openFile(file: ProjectFilePreviewRequest): void {
    navigate(store.openFile(file).id);
  }

  function bindSession(tabId: string, session: PineSessionSummary): void {
    const wasActive = activeTabId.value === tabId;
    const tab = store.bindSession(tabId, session);
    if (tab && wasActive && tab.id !== tabId) {
      navigate(tab.id, true);
    }
  }

  function failPrompt(tabId: string): void {
    const wasActive = activeTabId.value === tabId;
    const fallbackTabId = store.failPrompt(tabId);
    if (fallbackTabId && wasActive && fallbackTabId !== tabId) {
      navigate(fallbackTabId, true);
    }
  }

  function close(tabId: string): void {
    const currentActiveTabId = activeTabId.value;
    const nextActiveTabId = store.close(tabId, currentActiveTabId);
    if (tabId === currentActiveTabId) navigate(nextActiveTabId, true);
  }

  function removeSession(sessionId: string): void {
    const currentActiveTabId = activeTabId.value;
    const nextActiveTabId = store.removeSession(sessionId, currentActiveTabId);
    if (nextActiveTabId !== currentActiveTabId) {
      navigate(nextActiveTabId, true);
    }
  }

  return {
    activate: navigate,
    activeSessionTab,
    activeTab,
    activeTabId,
    bindSession,
    close,
    createSessionTab,
    failPrompt,
    openFile,
    openSession,
    removeSession,
    tabs,
  };
}
