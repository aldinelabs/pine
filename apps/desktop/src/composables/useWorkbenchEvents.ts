import { SIDE_CHAT_PANEL } from "@/shared/workbench";
import { onBeforeUnmount, onMounted } from "vue";
import type { PineSessionEvent } from "@/shared/agent";
import { parseFileReveal } from "@/shared/projectFiles";
import { useAttentionFlashStore } from "@/stores/attentionFlash";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useWorkbenchStore } from "@/stores/workbench";
import { onSessionEvent } from "@/client/sessionEvents";
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
  const attentionFlash = useAttentionFlashStore();
  const navigation = useContentTabNavigation();

  function handleEvent(event: PineSessionEvent): void {
    if (event.type === "present-file") {
      // Main resolved the path already, so the renderer never sees a raw one.
      contentTabs.rememberPresentedTarget(event.toolCallId, event.target);
      const reveal = parseFileReveal(event.reveal);
      if (event.display === "fullscreen") {
        // The tab opens behind the user's current one and pulses until they
        // reach it; the agent never takes their focus.
        const tab = contentTabs.presentFile(
          event.target,
          event.projectId,
          event.toolCallId,
          reveal,
        );
        if (navigation.activeTab.value?.id !== tab.id)
          attentionFlash.flash(tab.id);
        return;
      }
      workbench.present(event.sessionId, {
        target: event.target,
        toolCallId: event.toolCallId,
        path: event.path,
        ...(reveal ? { reveal } : {}),
      });
      workbench.highlight(event.sessionId, "preview");
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
          // The agent's view leaves out the user's side chat card.
          top: layout.top === SIDE_CHAT_PANEL ? null : layout.top,
          bottom: layout.bottom === SIDE_CHAT_PANEL ? null : layout.bottom,
          split: layout.split,
        },
      });
    }
  }

  let stopListening: (() => void) | undefined;
  let stopSnapshots: (() => void) | undefined;
  onMounted(() => {
    stopListening = onSessionEvent(handleEvent);
    stopSnapshots = window.pine?.onSessionSnapshot?.((snapshots) => {
      for (const snapshot of snapshots)
        for (const event of snapshot.events)
          if (
            event.type === "present-file" ||
            event.type === "workbench-command"
          )
            handleEvent(event);
    });
  });
  onBeforeUnmount(() => {
    stopSnapshots?.();
    stopListening?.();
    stopListening = undefined;
  });
}
