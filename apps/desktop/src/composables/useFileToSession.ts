import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import type { ProjectFilePreviewRequest } from "@/shared/projectFiles";
import type { AttachmentSelection } from "@/shared/attachments";
import type { PineQuote } from "@/shared/quotes";
import type { PineSessionSummary } from "@/shared/sessions";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useProjectStore } from "@/stores/project";
import { useContentTabNavigation } from "./useContentTabNavigation";

export function useFileToSession() {
  const { t } = useI18n();
  const tabs = useContentTabsStore();
  const project = useProjectStore();
  const navigation = useContentTabNavigation();
  const pending = ref(0);
  const isSending = computed(() => pending.value > 0);

  /** The session tab a file's content goes to, opened or created as needed. */
  function targetTab(
    projectId: string,
    target: string | PineSessionSummary | null,
  ) {
    return target === null
      ? tabs.createSessionTab({ projectId, reuseDraft: false })
      : typeof target === "string"
        ? tabs.tabs.find(
            (tab) =>
              tab.id === target &&
              tab.kind === "session" &&
              tab.projectId === projectId,
          )
        : tabs.openSession(target, projectId);
  }

  async function sendFile(
    file: ProjectFilePreviewRequest,
    target: string | PineSessionSummary | null,
    selection?: AttachmentSelection,
  ): Promise<void> {
    if (!project.isOpen(file.projectId)) return;
    pending.value += 1;
    try {
      const result = await window.pine.inspectProjectAttachments([
        {
          folderId: file.folderId,
          projectId: file.projectId,
          relativePath: file.relativePath,
        },
      ]);
      // Do not deliver late results once the project has closed. A file only
      // goes to sessions of its own project, whose sandbox can read it.
      if (!project.isOpen(file.projectId)) return;
      const tab = targetTab(file.projectId, target);
      const attachments = selection
        ? result.attachments.map((attachment) => ({ ...attachment, selection }))
        : result.attachments;
      if (!tab || !tabs.addAttachments(tab.id, attachments)) return;
      navigation.activate(tab.id);
    } catch (error) {
      handleError(error, {
        id: "project.preview.send",
        title: t("project.preview.sendFailed"),
      });
    } finally {
      pending.value -= 1;
    }
  }

  function sendFileToNewSession(
    file: ProjectFilePreviewRequest,
    selection?: AttachmentSelection,
  ): Promise<void> {
    return sendFile(file, null, selection);
  }

  /**
   * Puts comments on a file into a session's composer and shows that
   * session. Each comment names its file, so the file is not attached too. The quotes are built from the file's
   * absolute path, which only the main process knows. False when nothing
   * could be delivered, so the caller keeps its comments.
   */
  async function sendQuotes(
    file: ProjectFilePreviewRequest,
    target: string | null,
    quotesFor: (path: string) => PineQuote[],
  ): Promise<boolean> {
    if (!project.isOpen(file.projectId)) return false;
    pending.value += 1;
    try {
      const result = await window.pine.inspectProjectAttachments([
        {
          folderId: file.folderId,
          projectId: file.projectId,
          relativePath: file.relativePath,
        },
      ]);
      const attachment = result.attachments[0];
      if (!attachment || !project.isOpen(file.projectId)) return false;
      const quotes = quotesFor(attachment.path);
      const tab = targetTab(file.projectId, target);
      if (!quotes.length || !tab || !tabs.addQuotes(tab.id, quotes))
        return false;
      navigation.activate(tab.id);
      return true;
    } catch (error) {
      handleError(error, {
        id: "project.preview.send",
        title: t("project.preview.sendFailed"),
      });
      return false;
    } finally {
      pending.value -= 1;
    }
  }

  return { isSending, sendFile, sendFileToNewSession, sendQuotes };
}
