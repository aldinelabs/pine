import { storeToRefs } from "pinia";
import { onBeforeUnmount, onMounted, watch } from "vue";
import type { PineSessionEvent } from "@/shared/agent";
import type { FilePreviewTarget } from "@/shared/projectFiles";
import { useAttentionFlashStore } from "@/stores/attentionFlash";
import { useContentTabsStore } from "@/stores/contentTabs";

export interface PresentedFileSurfaces {
  /** Bring a tab into view without activating it or moving the user's focus. */
  reveal: (tabId: string) => void;
  /** True when the user is already looking at that tab. */
  isActive: (tabId: string) => boolean;
}

/**
 * Opens the file tabs the agent presents with `ui_present_file`, and flashes
 * each one so the user notices it without being pulled away from what they
 * were doing. Flashing is only *started* here: the tab bar stops it when the
 * user hovers, activates, or closes the tab.
 *
 * Unmounting (or closing a project) drops the subscription and every flash, so
 * a stale signal can never outlive the surface that showed it.
 */
export function usePresentedFiles({
  reveal,
  isActive,
}: PresentedFileSurfaces): void {
  const tabsStore = useContentTabsStore();
  const flash = useAttentionFlashStore();
  const { tabs } = storeToRefs(tabsStore);

  function present(target: FilePreviewTarget, toolCallId: string): void {
    const tab = tabsStore.presentFile(target, toolCallId);
    reveal(tab.id);
    // A tab the user is already reading needs no attention signal.
    if (!isActive(tab.id)) flash.flash(tab.id);
  }

  function handleEvent(event: PineSessionEvent): void {
    // Main resolves the path into a project or presented target first, so an
    // unresolved request never reaches the renderer.
    if (event.type !== "present-file") return;
    present(event.target, event.toolCallId);
  }

  let stopListening: (() => void) | undefined;
  onMounted(() => {
    stopListening = window.pine.onSessionEvent(handleEvent);
  });

  onBeforeUnmount(() => {
    stopListening?.();
    stopListening = undefined;
    flash.stopAll();
  });

  watch(
    () => tabs.value.map((tab) => tab.id),
    (ids) => flash.retain(ids),
    { flush: "sync" },
  );
}
