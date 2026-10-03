import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, shallowRef } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, it, vi } from "vitest";
import { useContentTabsStore } from "@/stores/contentTabs";
import {
  useWindowTabShortcuts,
  WINDOW_TAB_CLOSE_HANDLER_KEY,
  type WindowTabCloseHandler,
} from "../useWindowTabShortcuts";

describe("window close navigation", () => {
  it("closes tabs, clears the route, then closes the window only on the next request", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        // The workspace is the only route, as in the app.
        { path: "/", component: {} },
      ],
    });
    const store = useContentTabsStore();
    const file = store.openFile({
      projectId: "p1",
      folderId: "f1",
      relativePath: "notes.txt",
    });
    await router.push({
      path: "/",
      query: { tab: file.id, sidebar: "files" },
    });
    let requestClose!: () => void;
    let requestNewTab!: () => void;
    const unsubscribe = vi.fn();
    const unsubscribeNewTab = vi.fn();
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        closeWindow,
        onNewTabRequested: (listener: () => void) => {
          requestNewTab = listener;
          return unsubscribeNewTab;
        },
        onCloseTabRequested: (listener: () => void) => {
          requestClose = listener;
          return unsubscribe;
        },
      },
    });
    const wrapper = mount(
      defineComponent({
        setup() {
          useWindowTabShortcuts();
          return () => null;
        },
      }),
      { global: { plugins: [pinia, router] } },
    );
    requestClose();
    expect(store.tabs.map((tab) => tab.id)).toEqual(["session-1"]);
    await flushPromises();
    expect(router.currentRoute.value.query.tab).toBe("session-1");
    requestClose();
    await flushPromises();
    expect(store.tabs).toEqual([]);
    expect(router.currentRoute.value.query).toEqual({ sidebar: "files" });
    expect(closeWindow).not.toHaveBeenCalled();
    requestClose();
    expect(closeWindow).toHaveBeenCalledTimes(1);
    requestNewTab();
    await flushPromises();
    const firstDraft = router.currentRoute.value.query.tab;
    expect(store.tabs).toHaveLength(1);
    requestNewTab();
    await flushPromises();
    expect(store.tabs).toHaveLength(2);
    expect(router.currentRoute.value.query.tab).not.toBe(firstDraft);
    wrapper.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(unsubscribeNewTab).toHaveBeenCalledOnce();
  });

  it("delegates project close shortcuts to the registered tab close handler", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: {} }],
    });
    await router.push({ path: "/", query: { tab: "session-1" } });

    let requestClose!: () => void;
    const closeTab = vi.fn<WindowTabCloseHandler>();
    const closeTabHandler = shallowRef<WindowTabCloseHandler | null>(closeTab);
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        onNewTabRequested: () => () => undefined,
        onCloseTabRequested: (listener: () => void) => {
          requestClose = listener;
          return () => undefined;
        },
        closeWindow: vi.fn().mockResolvedValue(undefined),
      },
    });

    const wrapper = mount(
      defineComponent({
        setup() {
          useWindowTabShortcuts();
          return () => null;
        },
      }),
      {
        global: {
          plugins: [pinia, router],
          provide: {
            [WINDOW_TAB_CLOSE_HANDLER_KEY as symbol]: closeTabHandler,
          },
        },
      },
    );

    requestClose();
    expect(closeTab).toHaveBeenCalledExactlyOnceWith("session-1");
    expect(useContentTabsStore().tabs).toHaveLength(1);
    wrapper.unmount();
  });
});
