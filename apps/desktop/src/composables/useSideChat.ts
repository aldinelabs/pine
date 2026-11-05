import { toast } from "vue-sonner";
import { useI18n } from "vue-i18n";
import type { PineSideChatAnchor } from "@/shared/sideChats";
import { useSessionStore } from "@/stores/session";
import { useSideChatStore } from "@/stores/sideChat";
import { useWorkbenchStore } from "@/stores/workbench";

/**
 * Opens and closes side chats of the active conversation and shows them in
 * the workbench. A plain side chat is not saved, so leaving it asks first.
 */
export function useSideChat() {
  const { t } = useI18n();
  const sessionStore = useSessionStore();
  const sideChats = useSideChatStore();
  const workbench = useWorkbenchStore();

  function parent(): { projectId: string; sessionId: string } | undefined {
    const sessionId = sessionStore.activeSession?.id;
    const projectId = sessionId ? sessionStore.projectOf(sessionId) : undefined;
    return sessionId && projectId ? { projectId, sessionId } : undefined;
  }

  /** Whether the current side chat may be left, asking if it is not saved. */
  async function mayLeave(sessionId: string, next?: string): Promise<boolean> {
    const current = sideChats.active(sessionId);
    if (!current || current.persistent || current.id === next) return true;
    return sideChats.confirmDiscard();
  }

  async function open(
    options: {
      anchor?: PineSideChatAnchor;
      sideChatId?: string;
    } = {},
  ): Promise<boolean> {
    const target = parent();
    if (!target) return false;
    const current = sideChats.active(target.sessionId);
    // A plain side chat already open is shown again rather than replaced.
    if (
      !options.anchor &&
      !options.sideChatId &&
      current &&
      !current.persistent
    ) {
      workbench.showSideChat();
      return true;
    }
    if (!(await mayLeave(target.sessionId, options.sideChatId))) return false;
    try {
      await sideChats.open({ ...target, ...options });
      workbench.showSideChat();
      return true;
    } catch {
      toast.error(t("project.sideChat.openFailed"));
      return false;
    }
  }

  /** Closes the side chat and its card. */
  async function close(): Promise<boolean> {
    const target = parent();
    if (!target) return false;
    if (!(await mayLeave(target.sessionId))) return false;
    const current = sideChats.active(target.sessionId);
    workbench.closeCard("side-chat");
    if (current) await sideChats.close(current.id).catch(() => undefined);
    return true;
  }

  return { close, open, parent };
}
