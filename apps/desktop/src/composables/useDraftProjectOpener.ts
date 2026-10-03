import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { handleError } from "@/app/errors/errorHandler";
import { useProjectStore } from "@/stores/project";

/**
 * Open a project a draft is about to target. Resolves false when another
 * window owns it or it fails to open; the user has been told why.
 */
export function useDraftProjectOpener() {
  const { t } = useI18n();
  const projectStore = useProjectStore();

  return async function openForDraft(projectId: string): Promise<boolean> {
    try {
      const result = await projectStore.ensureOpen(projectId);
      if (result.opened) return true;
      toast.info(t("projects.openElsewhere"));
    } catch (error) {
      handleError(error, {
        id: `project.open.${projectId}`,
        title: t("errors.projectOpen.title"),
        description: t("errors.projectOpen.description"),
      });
    }
    return false;
  };
}
