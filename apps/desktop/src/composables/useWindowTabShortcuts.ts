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
        else void navigation.close(tabId);
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
  // ⌘⇧T brings back the last closed tab; ⌘1–⌘8 jump to that tab and ⌘9 to
  // the last one, as in browsers.
  useEventListener(window, "keydown", (event: KeyboardEvent) => {
    if (
      !(event.metaKey || event.ctrlKey) ||
      event.altKey ||
      event.defaultPrevented
    )
      return;
    if (event.shiftKey) {
      if (event.key.toLowerCase() !== "t") return;
      event.preventDefault();
      navigation.reopenClosedTab();
      return;
    }
    if (!/^[1-9]$/.test(event.key)) return;
    const list = tabs.tabs;
    const target =
      event.key === "9" ? list.at(-1) : list[Number(event.key) - 1];
    if (!target) return;
    event.preventDefault();
    navigation.activate(target.id);
  });
  onUnmounted(() => {
    unsubscribe?.();
    unsubscribeNewTab?.();
  });
}
