import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import {
  containsFileDrag,
  externalFilePaths,
  readProjectEntryDrag,
} from "@/lib/projectFileDrag";
import { hasSessionDrag, readSessionDrag } from "@/lib/sessionDrag";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useSessionStore } from "@/stores/session";

/** Whether a drag carries files or a session that a session tab can attach. */
export function dragContainsAttachments(event: DragEvent): boolean {
  return (
    containsFileDrag(event.dataTransfer) || hasSessionDrag(event.dataTransfer)
  );
}

/** Attach dropped files or a dropped session to a session tab. */
export function useAttachmentDrop() {
  const { t } = useI18n();
  const contentTabs = useContentTabsStore();
  const sessionStore = useSessionStore();

  /** Resolves true once something was attached. */
  async function attachDrop(
    transfer: DataTransfer | null,
    tabId: string,
    projectId: string,
  ): Promise<boolean> {
    if (!transfer) return false;
    try {
      const sessionId = readSessionDrag(transfer);
      if (sessionId) {
        const result = await window.pine.attachSession({
          projectId: sessionStore.projectOf(sessionId) ?? projectId,
          sessionId,
        });
        contentTabs.addAttachments(tabId, [result.attachment]);
        return true;
      }
      // Files from another project's tree stay outside this session's sandbox.
      const entries = readProjectEntryDrag(transfer)?.filter(
        (entry) => entry.projectId === projectId,
      );
      if (entries?.length === 0) return false;
      const paths = entries ? [] : externalFilePaths(transfer);
      if (!entries && !paths.length) return false;
      const result = entries
        ? await window.pine.inspectProjectAttachments(entries)
        : await window.pine.inspectAttachments({ paths });
      return (
        result.attachments.length > 0 &&
        contentTabs.addAttachments(tabId, result.attachments)
      );
    } catch {
      toast.error(t("project.composer.attachmentDropFailed"));
      return false;
    }
  }

  return { attachDrop };
}
