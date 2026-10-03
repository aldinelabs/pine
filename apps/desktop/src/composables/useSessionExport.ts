import { toast } from "vue-sonner";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import { useSessionStore } from "@/stores/session";

export function useSessionExport() {
  const { t } = useI18n();
  const sessionStore = useSessionStore();

  async function exportSession(sessionId: string): Promise<boolean> {
    try {
      const projectId = sessionStore.projectOf(sessionId);
      if (!projectId) throw new Error("The session's project is unknown.");
      const result = await window.pine.exportSession({ projectId, sessionId });
      if (result.saved) {
        toast.success(t("sessions.exportSuccess"));
      }
      return result.saved;
    } catch (error) {
      handleError(error, {
        id: "sessions.export",
        title: t("sessions.exportFailedTitle"),
        description: t("sessions.exportFailedDescription"),
      });
      return false;
    }
  }

  return { exportSession };
}
