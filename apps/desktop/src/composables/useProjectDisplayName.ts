import { useI18n } from "vue-i18n";
import { isTemporaryWorkspace, type PineProject } from "@/shared/projects";

/** The temporary workspace shows a localized name instead of its stored one. */
export function useProjectDisplayName() {
  const { t } = useI18n();
  return (project: Pick<PineProject, "id" | "name"> | null | undefined) =>
    project
      ? isTemporaryWorkspace(project.id)
        ? t("projects.temporaryWorkspace")
        : project.name
      : "";
}
