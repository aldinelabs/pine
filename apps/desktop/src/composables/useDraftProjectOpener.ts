import { inject, type InjectionKey } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { handleError } from "@/app/errors/errorHandler";
import { useProjectStore } from "@/stores/project";

export type DraftProjectOpener = (projectId: string) => Promise<boolean>;

/**
 * Replaces how drafts below open their project, for a composer whose message
 * is sent from another window.
 */
export const DRAFT_PROJECT_OPENER_KEY: InjectionKey<DraftProjectOpener> =
  Symbol("draft-project-opener");

/**
 * Open a project a draft is about to target. Resolves false when another
 * window owns it or it fails to open; the user has been told why.
 */
export function useDraftProjectOpener(): DraftProjectOpener {
  const { t } = useI18n();
  const projectStore = useProjectStore();
  const override = inject(DRAFT_PROJECT_OPENER_KEY, null);
  if (override) return override;

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
