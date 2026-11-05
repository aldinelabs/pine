import { toast } from "vue-sonner";
import { useI18n } from "vue-i18n";
import type { PineSideChatAnchor } from "@/shared/sideChats";
import { panelPosition } from "@/lib/workbenchLayout";
import {
  SIDE_CHAT_PANEL,
  type WorkbenchPanel,
  type WorkbenchPosition,
} from "@/shared/workbench";
import { useContentTabsStore } from "@/stores/contentTabs";
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
  const contentTabs = useContentTabsStore();

  /**
   * A side chat lives as long as its conversation's tab, so that tab stops
   * being a preview another casual open would replace.
   */
  function keepTabOf(sessionId: string): void {
    const tab = contentTabs.tabs.find(
      (candidate) =>
        candidate.kind === "session" &&
        candidate.state === "bound" &&
        candidate.sessionId === sessionId,
    );
    if (tab) contentTabs.keepTab(tab.id);
  }

  function parent(): { projectId: string; sessionId: string } | undefined {
    const sessionId = sessionStore.activeSession?.id;
    const projectId = sessionId ? sessionStore.projectOf(sessionId) : undefined;
    return sessionId && projectId ? { projectId, sessionId } : undefined;
  }

  /**
   * Whether the current side chat may be left, asking if leaving loses
   * something: a plain side chat with questions in it.
   */
  async function mayLeave(sessionId: string, next?: string): Promise<boolean> {
    const current = sideChats.active(sessionId);
    if (
      !current ||
      current.persistent ||
      current.id === next ||
      current.messages.length === 0
    )
      return true;
    return sideChats.confirmDiscard();
  }

  async function open(
    options: {
      anchor?: PineSideChatAnchor;
      sideChatId?: string;
    } = {},
  ): Promise<boolean> {
    const request = options;
    const target = parent();
    if (!target) return false;
    const current = sideChats.active(target.sessionId);
    // A plain side chat already open is shown again rather than replaced.
    if (
      !request.anchor &&
      !request.sideChatId &&
      current &&
      !current.persistent
    ) {
      workbench.showSideChat();
      return true;
    }
    if (!(await mayLeave(target.sessionId, request.sideChatId))) return false;
    try {
      await sideChats.open({ ...target, ...request });
      keepTabOf(target.sessionId);
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

  /**
   * Shows a panel in a card, as the card menus do. A side chat whose card
   * gives way to another panel ends with it, asking first if that loses it.
   */
  async function showPanel(
    position: WorkbenchPosition,
    panel: WorkbenchPanel,
  ): Promise<boolean> {
    const layout = workbench.activeLayout;
    const endsSideChat =
      layout[position] === SIDE_CHAT_PANEL &&
      panel !== SIDE_CHAT_PANEL &&
      // A panel shown in the other card swaps places instead.
      !panelPosition(layout, panel);
    const target = parent();
    if (endsSideChat && target) {
      if (!(await mayLeave(target.sessionId))) return false;
      const current = sideChats.active(target.sessionId);
      if (current) await sideChats.close(current.id).catch(() => undefined);
    }
    workbench.showPanel(position, panel);
    return true;
  }

  return { close, open, parent, showPanel };
}
