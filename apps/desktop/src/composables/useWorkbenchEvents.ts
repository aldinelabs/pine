import { onBeforeUnmount, onMounted } from "vue";
import type { PineSessionEvent } from "@/shared/agent";
import { parseFileReveal } from "@/shared/projectFiles";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useWorkbenchStore } from "@/stores/workbench";
import { useContentTabNavigation } from "./useContentTabNavigation";

/**
 * Routes the agent's workbench requests to the session that made them: a
 * presented file opens in its preview card or a full content tab; `ui_workbench_*`
 * commands rearrange its cards. Sessions in the background change their own
 * layout only, so the user sees it when they switch to them.
 */
export function useWorkbenchEvents(): void {
  const workbench = useWorkbenchStore();
  const contentTabs = useContentTabsStore();
  const navigation = useContentTabNavigation();

  function handleEvent(event: PineSessionEvent): void {
    if (event.type === "present-file") {
      // Main resolved the path already, so the renderer never sees a raw one.
      contentTabs.rememberPresentedTarget(event.toolCallId, event.target);
      const reveal = parseFileReveal(event.reveal);
      if (event.display === "fullscreen") {
        const activeTab = navigation.activeTab.value;
        const foreground =
          (activeTab?.kind === "session" &&
            activeTab.state === "bound" &&
            activeTab.sessionId === event.sessionId) ||
          (activeTab?.kind === "file" &&
            activeTab.projectId === event.projectId &&
            workbench.activeKey === event.sessionId);
        const tab = contentTabs.presentFile(
          event.target,
          event.projectId,
          event.toolCallId,
          reveal,
        );
        if (foreground) navigation.activate(tab.id);
        return;
      }
      workbench.present(event.sessionId, {
        target: event.target,
        toolCallId: event.toolCallId,
        ...(reveal ? { reveal } : {}),
      });
    } else if (event.type === "workbench-command") {
      workbench.apply(event.sessionId, event.command);
    } else if (event.type === "workbench-state-request") {
      const layout = workbench.layoutFor(event.sessionId);
      window.pine.respondWorkbenchState({
        requestId: event.requestId,
        state: {
          open: layout.open,
          visible:
            workbench.activeKey === event.sessionId && workbench.displayedOpen,
          top: layout.top,
          bottom: layout.bottom,
          split: layout.split,
        },
      });
    }
  }

  let stopListening: (() => void) | undefined;
  onMounted(() => {
    stopListening = window.pine?.onSessionEvent?.(handleEvent);
  });
  onBeforeUnmount(() => {
    stopListening?.();
    stopListening = undefined;
  });
}
