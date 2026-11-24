import { useI18n } from "vue-i18n";
import { isAssistantProject } from "@/shared/assistant";
import { isTemporaryWorkspace, type PineProject } from "@/shared/projects";

/**
 * The temporary workspace and the Assistant show a localized name instead
 * of their stored one.
 */
export function useProjectDisplayName() {
  const { t } = useI18n();
  return (project: Pick<PineProject, "id" | "name"> | null | undefined) =>
    project
      ? isTemporaryWorkspace(project.id)
        ? t("projects.temporaryWorkspace")
        : isAssistantProject(project.id)
          ? t("assistant.name")
          : project.name
      : "";
}
