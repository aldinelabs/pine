import { useEventListener } from "@vueuse/core";
import {
  inject,
  onMounted,
  onUnmounted,
  type InjectionKey,
  type Ref,
} from "vue";
import { useContentTabNavigation } from "./useContentTabNavigation";
import { useContentTabsStore } from "@/stores/contentTabs";

export type WindowTabCloseHandler = (tabId: string) => void;
export const WINDOW_TAB_CLOSE_HANDLER_KEY: InjectionKey<
  Ref<WindowTabCloseHandler | null>
> = Symbol("window-tab-close-handler");

export function useWindowTabShortcuts(): void {
  const navigation = useContentTabNavigation();
  const tabs = useContentTabsStore();
  const closeTabHandler = inject(WINDOW_TAB_CLOSE_HANDLER_KEY);
  let unsubscribe: (() => void) | undefined;
  let unsubscribeNewTab: (() => void) | undefined;
  onMounted(() => {
    unsubscribeNewTab = window.pine.onNewTabRequested(() => {
      navigation.activate(tabs.createSessionTab({ reuseDraft: false }).id);
    });
    unsubscribe = window.pine.onCloseTabRequested(() => {
      if (navigation.activeTab.value) {
        const tabId = navigation.activeTabId.value;
        if (closeTabHandler?.value) closeTabHandler.value(tabId);
        else navigation.close(tabId);
      } else {
        void window.pine.closeWindow();
      }
    });
  });
  // ⌘⌥← / ⌘⌥→ step through the tabs, wrapping at either end.
  useEventListener(window, "keydown", (event: KeyboardEvent) => {
    const step =
      event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (
      !step ||
      !event.altKey ||
      !(event.metaKey || event.ctrlKey) ||
      event.shiftKey ||
      event.defaultPrevented
    )
      return;
    const list = tabs.tabs;
    if (list.length < 2) return;
    event.preventDefault();
    const index = list.findIndex(
      (tab) => tab.id === navigation.activeTabId.value,
    );
    const next = list[(index + step + list.length) % list.length];
    if (next) navigation.activate(next.id);
  });
  onUnmounted(() => {
    unsubscribe?.();
    unsubscribeNewTab?.();
  });
}
