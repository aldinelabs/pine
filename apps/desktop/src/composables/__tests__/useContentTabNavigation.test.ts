import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, it } from "vitest";
import { useContentTabsStore } from "@/stores/contentTabs";
import { CONTENT_TABS_STORAGE_KEY } from "@/lib/contentTabStorage";
import { useContentTabNavigation } from "../useContentTabNavigation";

function createWorkspaceRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: {} }],
  });
}

function mountNavigation(
  pinia: ReturnType<typeof createPinia>,
  router: ReturnType<typeof createWorkspaceRouter>,
) {
  let navigation!: ReturnType<typeof useContentTabNavigation>;
  const wrapper = mount(
    defineComponent({
      setup() {
        navigation = useContentTabNavigation();
        return () => h("span", navigation.activeTabId.value);
      },
    }),
    { global: { plugins: [pinia, router] } },
  );
  return { navigation, wrapper };
}

describe("persisted content tab navigation", () => {
  it("keeps a restored empty workspace unselected even with a stale tab query", async () => {
    setActivePinia(createPinia());
    useContentTabsStore().close("session-1", "session-1");
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useContentTabsStore();
    const router = createWorkspaceRouter();
    await router.push("/?tab=session-1");

    const { navigation, wrapper } = mountNavigation(pinia, router);

    expect(navigation.activeTabId.value).toBe("");
    expect(navigation.activeTab.value).toBeNull();
    expect(store.tabs).toEqual([]);
    wrapper.unmount();
  });

  it("restores selection without a query and records tab changes", async () => {
    setActivePinia(createPinia());
    const first = useContentTabsStore();
    const file = first.openFile({
      projectId: "one",
      folderId: "root",
      relativePath: "notes.txt",
    });
    first.setActiveTab(file.id);
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useContentTabsStore();
    const router = createWorkspaceRouter();
    await router.push("/");

    const { wrapper } = mountNavigation(pinia, router);
    expect(wrapper.text()).toBe(file.id);

    await router.push({ query: { tab: "session-1" } });
    await flushPromises();
    expect(store.fallbackActiveTabId).toBe("session-1");
    expect(
      JSON.parse(localStorage.getItem(CONTENT_TABS_STORAGE_KEY)!),
    ).toMatchObject({ activeTabId: "session-1" });
    wrapper.unmount();
  });

  it("opens a session in the project it belongs to", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createWorkspaceRouter();
    await router.push("/");
    const { navigation, wrapper } = mountNavigation(pinia, router);

    navigation.openSession(
      {
        createdAt: "",
        id: "s1",
        messageCount: 1,
        updatedAt: "",
      },
      "two",
    );
    await flushPromises();

    expect(navigation.activeTab.value).toMatchObject({
      projectId: "two",
      sessionId: "s1",
    });
    wrapper.unmount();
  });
});
