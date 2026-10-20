import { onBeforeUnmount, onMounted } from "vue";
import type { PineSessionEvent } from "@/shared/agent";
import { parseFileReveal } from "@/shared/projectFiles";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useWorkbenchStore } from "@/stores/workbench";

/**
 * Routes the agent's workbench requests to the session that made them: a
 * presented file opens in that session's preview card, and `ui_workbench_*`
 * commands rearrange its cards. Sessions in the background change their own
 * layout only, so the user sees it when they switch to them.
 */
export function useWorkbenchEvents(): void {
  const workbench = useWorkbenchStore();
  const contentTabs = useContentTabsStore();

  function handleEvent(event: PineSessionEvent): void {
    if (event.type === "present-file") {
      // Main resolved the path already, so the renderer never sees a raw one.
      contentTabs.rememberPresentedTarget(event.toolCallId, event.target);
      const reveal = parseFileReveal(event.reveal);
      workbench.present(event.sessionId, {
        target: event.target,
        toolCallId: event.toolCallId,
        ...(reveal ? { reveal } : {}),
      });
    } else if (event.type === "workbench-command") {
      workbench.apply(event.sessionId, event.command);
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
