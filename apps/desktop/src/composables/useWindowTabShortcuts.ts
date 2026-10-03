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
  onUnmounted(() => {
    unsubscribe?.();
    unsubscribeNewTab?.();
  });
}
